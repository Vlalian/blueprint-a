// The Azure DevOps host adapter on recorded replies (fixtures/azure-devops, see its README): no real
// Azure DevOps API is called. The fake client answers each request from the reply recorded for its
// method and path, and keeps every request for the asserts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { azureDevOpsHost, PAT_VARIABLE, type AzureDevOpsConfig } from './azure-devops.ts';
import { githubHost } from './github.ts';
import { verdictOf } from './host.ts';
import type { HttpReply, HttpRequest } from './http.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'azure-devops');
const recorded = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const SHA = '4c1e2f0a9b8d7c6e5f4a3b2c1d0e9f8a7b6c5d4e';
const PAT = 'fake-token-for-tests';
const BASIC = Buffer.from(`:${PAT}`).toString('base64');
const CONFIG: AzureDevOpsConfig = { organization: 'fabrikam', project: 'Fabrikam-Fiber', repository: 'fabrikam-web' };
const ROOT = 'https://dev.azure.com/fabrikam/Fabrikam-Fiber/_apis/';

type Route = [method: string, path: string, reply: HttpReply];
const ok = (file: string, status = 200): HttpReply => ({ status, body: recorded(file) });

/** A client answering from recorded replies by method and path (the URL up to its query). */
function replay(...routes: Route[]) {
  const requests: HttpRequest[] = [];
  const http = (req: HttpRequest): HttpReply => {
    requests.push(req);
    const path = req.url.split('?')[0]!.slice(ROOT.length);
    const route = routes.find(([m, p]) => m === req.method && p === path);
    if (!route) throw new Error(`no recorded reply for ${req.method} ${path}`);
    return route[2];
  };
  return { requests, host: azureDevOpsHost(CONFIG, http, { [PAT_VARIABLE]: PAT }) };
}

const query = (req: HttpRequest) => Object.fromEntries(new URL(req.url).searchParams);

describe('azureDevOpsHost: the PAT', () => {
  it('could not run without the PAT, naming the variable and asking nothing', () => {
    const asked: HttpRequest[] = [];
    expect(() => azureDevOpsHost(CONFIG, (r) => (asked.push(r), ok('pr-active.json')), {})).toThrow(
      'AZURE_DEVOPS_PAT is not set: the Azure DevOps host reads its personal access token from that environment variable only',
    );
    expect(() => azureDevOpsHost(CONFIG, (r) => (asked.push(r), ok('pr-active.json')), { AZURE_DEVOPS_PAT: '' })).toThrow(/^AZURE_DEVOPS_PAT is not set/);
    expect(asked).toEqual([]);
    expect(PAT_VARIABLE).toBe('AZURE_DEVOPS_PAT');
  });

  it('sends the PAT as basic auth with an empty user name, and JSON is what it accepts', () => {
    const { host, requests } = replay(['GET', 'build/builds', ok('builds-pending.json')]);
    host.checksForCommit(SHA);
    expect(requests[0]!.headers).toEqual({ Authorization: `Basic ${BASIC}`, Accept: 'application/json' });
  });

  it.each([
    ['an error reply that echoes the token', { status: 401, body: `bad token ${PAT} (${BASIC})` }],
    ['the sign-in page instead of JSON', { status: 203, body: `<html>${recorded('unauthorized.html')}${BASIC}</html>` }],
  ])('keeps the PAT out of the error on %s', (_name, reply) => {
    const { host } = replay(['GET', 'build/builds', reply]);
    let message = '';
    try {
      host.checksForCommit(SHA);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^Azure DevOps GET build\/builds answered (401|203)/);
    expect(message).not.toContain(PAT);
    expect(message).not.toContain(BASIC);
  });

  it('keeps the PAT out of the error when no reply came', () => {
    const host = azureDevOpsHost(CONFIG, () => { throw new Error(`proxy refused Basic ${BASIC}`); }, { AZURE_DEVOPS_PAT: PAT });
    expect(() => host.checksForCommit(SHA)).toThrow('Azure DevOps GET build/builds: proxy refused Basic [redacted]');
  });
});

describe('azureDevOpsHost: checks for a commit', () => {
  it('lists the project builds newest first and reads only those of the exact commit', () => {
    const { host, requests } = replay(['GET', 'build/builds', ok('builds-pending.json')]);
    expect(host.checksForCommit(SHA)).toEqual({ sha: SHA, state: 'pending', passed: [], failing: [], pending: ['ci'] });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('GET');
    expect(query(requests[0]!)).toEqual({ queryOrder: 'queueTimeDescending', $top: '200', 'api-version': '7.1' });
  });

  it('is failing when the commit run failed', () => {
    expect(replay(['GET', 'build/builds', ok('builds-failed.json')]).host.checksForCommit(SHA)).toEqual({ sha: SHA, state: 'failing', passed: [], failing: ['ci'], pending: [] });
  });

  it('is green when the newest run of each pipeline succeeded, an earlier failed run of it not counting', () => {
    expect(replay(['GET', 'build/builds', ok('builds-succeeded.json')]).host.checksForCommit(SHA)).toEqual({ sha: SHA, state: 'green', passed: ['e2e', 'ci'], failing: [], pending: [] });
  });

  it('is pending, never green, while no run of the commit is listed', () => {
    expect(replay(['GET', 'build/builds', ok('builds-other-commit.json')]).host.checksForCommit(SHA)).toMatchObject({ state: 'pending', passed: [], pending: [] });
  });

  it.each(['partiallySucceeded', 'canceled', 'none'])('reads a completed run with result %s as failing, never passed', (result) => {
    const body = JSON.stringify({ value: [{ status: 'completed', result, sourceVersion: SHA, definition: { name: 'ci' } }] });
    expect(replay(['GET', 'build/builds', { status: 200, body }]).host.checksForCommit(SHA)).toMatchObject({ state: 'failing', failing: ['ci'] });
  });

  it.each(['notStarted', 'postponed', 'cancelling', 'none'])('reads a run with status %s as pending', (status) => {
    const body = JSON.stringify({ value: [{ status, result: null, sourceVersion: SHA, definition: { name: 'ci' } }] });
    expect(replay(['GET', 'build/builds', { status: 200, body }]).host.checksForCommit(SHA)).toMatchObject({ state: 'pending', pending: ['ci'] });
  });

  it('refuses a SHA that is not a full commit id, asking nothing', () => {
    const { host, requests } = replay();
    expect(() => host.checksForCommit('HEAD')).toThrow(/full 40-character SHA/);
    expect(requests).toEqual([]);
  });
});

describe('VERIFIED / FAILED / NOT-VERIFIED, the same on both hosts', () => {
  const gh = (runs: Array<{ name: string; status: string; conclusion: string | null }>) =>
    githubHost((args) => ({ status: 0, stdout: JSON.stringify(args[3]!.endsWith('check-runs') ? { check_runs: runs } : { statuses: [] }), stderr: '' }));
  const cases: Array<[string, string, Array<{ name: string; status: string; conclusion: string | null }>, string]> = [
    ['a pipeline run still going', 'builds-pending.json', [{ name: 'ci', status: 'in_progress', conclusion: null }], 'NOT-VERIFIED'],
    ['a failed run', 'builds-failed.json', [{ name: 'ci', status: 'completed', conclusion: 'failure' }], 'FAILED'],
    ['succeeded runs', 'builds-succeeded.json', [{ name: 'e2e', status: 'completed', conclusion: 'success' }, { name: 'ci', status: 'completed', conclusion: 'success' }], 'VERIFIED'],
    ['nothing reported', 'builds-other-commit.json', [], 'NOT-VERIFIED'],
  ];

  it.each(cases)('%s', (_name, file, runs, verdict) => {
    const azure = replay(['GET', 'build/builds', ok(file)]).host.checksForCommit(SHA);
    const github = gh(runs).checksForCommit(SHA);
    expect(azure).toEqual(github);
    expect(verdictOf(azure.state)).toBe(verdict);
  });
});

describe('azureDevOpsHost: a draft PR', () => {
  it('opens a draft PR from the branch into the base when none is active, and never sets auto-complete', () => {
    const { host, requests } = replay(['GET', 'git/repositories/fabrikam-web/pullrequests', ok('pr-list-none.json')], ['POST', 'git/repositories/fabrikam-web/pullrequests', ok('pr-created.json', 201)]);
    expect(host.openDraftPr('ticket/07', 'dev', 'Ticket 07: export the report', 'Built and reviewed.')).toEqual({
      id: 22,
      url: 'https://dev.azure.com/fabrikam/Fabrikam-Fiber/_git/fabrikam-web/pullrequest/22',
      created: true,
      draft: true,
    });
    expect(query(requests[0]!)).toEqual({
      'searchCriteria.sourceRefName': 'refs/heads/ticket/07',
      'searchCriteria.targetRefName': 'refs/heads/dev',
      'searchCriteria.status': 'active',
      $top: '1',
      'api-version': '7.1',
    });
    const create = requests[1]!;
    expect(query(create)).toEqual({ 'api-version': '7.1' });
    expect(create.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(create.body!)).toEqual({ sourceRefName: 'refs/heads/ticket/07', targetRefName: 'refs/heads/dev', title: 'Ticket 07: export the report', description: 'Built and reviewed.', isDraft: true });
    expect(create.body).not.toMatch(/autoComplete|completionOptions/);
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST']);
  });

  it('reuses the active PR for the branch as it is: no second PR, no update', () => {
    const { host, requests } = replay(['GET', 'git/repositories/fabrikam-web/pullrequests', ok('pr-list-open.json')]);
    expect(host.openDraftPr('ticket/07', 'dev', 'T', 'B')).toMatchObject({ id: 22, created: false, draft: false });
    expect(requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('fails naming the call and status when the create is refused', () => {
    const { host } = replay(['GET', 'git/repositories/fabrikam-web/pullrequests', ok('pr-list-none.json')], ['POST', 'git/repositories/fabrikam-web/pullrequests', { status: 409, body: '{"message":"TF401179: An active pull request for the source and target branch already exists."}' }]);
    expect(() => host.openDraftPr('ticket/07', 'dev', 'T', 'B')).toThrow('Azure DevOps POST git/repositories/fabrikam-web/pullrequests answered 409: {"message":"TF401179');
  });

  it('puts names into the URL path encoded', () => {
    const requests: HttpRequest[] = [];
    const host = azureDevOpsHost({ organization: 'org x', project: 'Team/Proj', repository: 'web app' }, (r) => (requests.push(r), ok('pr-list-open.json')), { AZURE_DEVOPS_PAT: PAT });
    expect(host.openDraftPr('ticket/07', 'dev', 'T', 'B').url).toBe('https://dev.azure.com/org%20x/Team%2FProj/_git/web%20app/pullrequest/22');
    expect(requests[0]!.url.startsWith('https://dev.azure.com/org%20x/Team%2FProj/_apis/git/repositories/web%20app/pullrequests?')).toBe(true);
  });
});

describe('azureDevOpsHost: PR status', () => {
  const pr = (file: string) => replay(['GET', 'git/repositories/fabrikam-web/pullrequests/22', ok(file)], ['GET', 'policy/evaluations', ok('policy-evaluations-running.json')]);

  it('reads an open draft PR whose required Build policy is still running', () => {
    const { host, requests } = pr('pr-active.json');
    expect(host.prStatus('22')).toEqual({
      id: 22,
      url: 'https://dev.azure.com/fabrikam/Fabrikam-Fiber/_git/fabrikam-web/pullrequest/22',
      state: 'OPEN',
      draft: true,
      head: SHA,
      // The optional (non-blocking) policy that was rejected does not count.
      policies: { passed: ['Minimum number of reviewers'], failing: [], pending: ['Build'] },
    });
    expect(query(requests[1]!)).toEqual({ artifactId: 'vstfs:///CodeReview/CodeReviewId/a7573007-bbb3-4341-b726-0c4148a07853/22', 'api-version': '7.1-preview.1' });
    expect(requests.map((r) => r.method)).toEqual(['GET', 'GET']);
  });

  it.each([
    ['pr-completed.json', 'MERGED'],
    ['pr-abandoned.json', 'CLOSED'],
  ])('maps %s to %s', (file, state) => {
    expect(pr(file).host.prStatus('22').state).toBe(state);
  });

  it.each([
    ['rejected', 'failing'],
    ['broken', 'failing'],
    ['queued', 'pending'],
    ['approved', 'passed'],
  ])('counts a blocking policy %s as %s, and leaves out a disabled or not applicable one', (status, verdict) => {
    const ev = (s: string, isEnabled: boolean, name: string) => ({ status: s, configuration: { isEnabled, isBlocking: true, type: { displayName: name } } });
    const body = JSON.stringify({ value: [ev(status, true, 'Build'), ev('rejected', false, 'Off'), ev('notApplicable', true, 'Path filter')] });
    const { host } = replay(['GET', 'git/repositories/fabrikam-web/pullrequests/22', ok('pr-active.json')], ['GET', 'policy/evaluations', { status: 200, body }]);
    expect(host.prStatus('22').policies).toEqual({ passed: [], failing: [], pending: [], [verdict]: ['Build'] });
  });

  it('refuses a status it does not know, and an id that is not a number', () => {
    const odd = JSON.stringify({ ...JSON.parse(recorded('pr-active.json')), status: 'notSet' });
    expect(() => replay(['GET', 'git/repositories/fabrikam-web/pullrequests/22', { status: 200, body: odd }]).host.prStatus('22')).toThrow('Azure DevOps PR 22 has status "notSet"');
    const { host, requests } = replay();
    expect(() => host.prStatus('ticket/07')).toThrow('an Azure DevOps PR is named by its number, not "ticket/07"');
    expect(() => host.prStatus('22x')).toThrow('an Azure DevOps PR is named by its number, not "22x"');
    expect(() => host.prStatus('x22')).toThrow('an Azure DevOps PR is named by its number, not "x22"');
    expect(requests).toEqual([]);
  });
});

describe('azureDevOpsHost: work items', () => {
  it('reads a work item title, state and type', () => {
    const { host, requests } = replay(['GET', 'wit/workitems/299', ok('workitem.json')]);
    expect(host.workItem(299)).toEqual({ id: 299, title: 'Export the weekly report', state: 'Active', type: 'User Story' });
    expect(query(requests[0]!)).toEqual({ fields: 'System.Title,System.State,System.WorkItemType', 'api-version': '7.1' });
  });

  it('changes the state with a JSON patch and reads the answer', () => {
    const { host, requests } = replay(['PATCH', 'wit/workitems/299', ok('workitem-resolved.json')]);
    expect(host.setWorkItemState(299, 'Resolved')).toEqual({ id: 299, title: 'Export the weekly report', state: 'Resolved', type: 'User Story' });
    expect(requests[0]!.headers['Content-Type']).toBe('application/json-patch+json');
    expect(JSON.parse(requests[0]!.body!)).toEqual([{ op: 'add', path: '/fields/System.State', value: 'Resolved' }]);
    expect(query(requests[0]!)).toEqual({ 'api-version': '7.1' });
  });

  it('fails with the rule error when the process does not allow the state', () => {
    const { host } = replay(['PATCH', 'wit/workitems/299', ok('workitem-bad-state.json', 400)]);
    expect(() => host.setWorkItemState(299, 'Shipped')).toThrow(/^Azure DevOps PATCH wit\/workitems\/299 answered 400: .*TF401320: Rule Error for field State/s);
  });

  it('cuts a long error reply short', () => {
    const { host } = replay(['GET', 'wit/workitems/1', { status: 500, body: 'x'.repeat(1000) }]);
    expect(() => host.workItem(1)).toThrow(new RegExp(`answered 500: x{300}…$`));
  });

  it('keeps an error reply of up to 300 characters whole', () => {
    const { host } = replay(['GET', 'wit/workitems/1', { status: 500, body: 'x'.repeat(300) }]);
    expect(() => host.workItem(1)).toThrow(new RegExp(`answered 500: x{300}$`));
  });

  it('reads only a 2xx reply as an answer, even one with JSON', () => {
    const item = recorded('workitem.json');
    expect(replay(['GET', 'wit/workitems/299', { status: 299, body: item }]).host.workItem(299).state).toBe('Active');
    expect(() => replay(['GET', 'wit/workitems/299', { status: 199, body: item }]).host.workItem(299)).toThrow(/^Azure DevOps GET wit\/workitems\/299 answered 199: \{/);
    expect(() => replay(['GET', 'wit/workitems/299', { status: 300, body: item }]).host.workItem(299)).toThrow(/^Azure DevOps GET wit\/workitems\/299 answered 300: \{/);
  });
});
