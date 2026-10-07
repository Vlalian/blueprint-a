// The SonarQube adapter on recorded replies (fixtures/sonarqube, see its README): no real SonarQube
// is called. The fake client answers each request from the reply recorded for its path, and keeps
// every request for the asserts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HttpReply, HttpRequest } from '../host/http.ts';
import type { SonarConfig, SonarRef } from './config.ts';
import { awaitAnalysis, NEW_CODE_METRICS, sonarQubeAdapter, type AnalysisLook } from './sonarqube.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'sonarqube');
const recorded = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const SHA = '4c1e2f0a9b8d7c6e5f4a3b2c1d0e9f8a7b6c5d4e';
const OLD = '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d';
const TOKEN = 'squ_fake0token0for0tests0only00000000000';
const BASIC = Buffer.from(`${TOKEN}:`).toString('base64');
const CONFIG: SonarConfig = { server: 'https://sonar.example.test', projectKey: 'fabrikam-web' };
const BRANCH: SonarRef = { branch: 'dev' };
const PR: SonarRef = { pullRequest: '42', task: 'AZJ3kpZ1Lm2Nn3Oo4Pp5' };
const ok = (file: string): HttpReply => ({ status: 200, body: recorded(file) });

type Route = [path: string, reply: HttpReply | ((req: HttpRequest) => HttpReply)];

/** A client answering from recorded replies by path (the URL up to its query). */
function replay(...routes: Route[]) {
  const requests: HttpRequest[] = [];
  const http = (req: HttpRequest): HttpReply => {
    requests.push(req);
    const path = req.url.split('?')[0]!.slice(`${CONFIG.server}/`.length);
    const route = routes.find(([p]) => p === path);
    if (!route) throw new Error(`no recorded reply for ${path}`);
    return typeof route[1] === 'function' ? route[1](req) : route[1];
  };
  return { requests, sonar: sonarQubeAdapter(CONFIG, http, { SONAR_TOKEN: TOKEN }) };
}

const query = (req: HttpRequest) => Object.fromEntries(new URL(req.url).searchParams);

function errorOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

describe('sonarQubeAdapter: the token', () => {
  it('could not run without SONAR_TOKEN, naming the variable and asking nothing', () => {
    const asked: HttpRequest[] = [];
    const http = (r: HttpRequest) => (asked.push(r), ok('analyses-head.json'));
    const missing = 'SONAR_TOKEN is not set: the SonarQube adapter reads its token from that environment variable only';
    expect(() => sonarQubeAdapter(CONFIG, http, {})).toThrow(missing);
    expect(() => sonarQubeAdapter(CONFIG, http, { SONAR_TOKEN: '' })).toThrow(missing);
    expect(asked).toEqual([]);
  });

  it('sends the token as the basic-auth login with an empty password, GETs only, and accepts JSON', () => {
    const { sonar, requests } = replay(['api/project_analyses/search', ok('analyses-head.json')]);
    sonar.analysisFor(SHA, BRANCH);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.headers).toEqual({ Authorization: `Basic ${BASIC}`, Accept: 'application/json' });
    expect(requests[0]!.url).toMatch(/^https:\/\/sonar\.example\.test\/api\/project_analyses\/search\?/);
  });

  it.each([
    ['401 that echoes the token', { status: 401, body: `${recorded('unauthorized.json')} ${TOKEN} ${BASIC}` }, /^SonarQube GET api\/project_analyses\/search answered 401: \{"errors":\[\{"msg":"Authentication is required"\}\]\}/],
    ['403', { status: 403, body: recorded('forbidden.json') }, /answered 403: .*Insufficient privileges/],
    ['a 200 that is not JSON (a proxy sign-in page)', { status: 200, body: `<html>sign in ${TOKEN}</html>` }, /answered 200 with no JSON: <html>sign in \[redacted\]<\/html>$/],
    ['a 302', { status: 302, body: '' }, /answered 302: $/],
  ])('fails on a %s and keeps the token out of the error', (_name, reply, message) => {
    const { sonar } = replay(['api/project_analyses/search', reply]);
    const error = errorOf(() => sonar.analysisFor(SHA, BRANCH));
    expect(error).toMatch(message);
    expect(error).not.toContain(TOKEN);
    expect(error).not.toContain(BASIC);
  });

  it('takes only a 2xx reply as an answer', () => {
    expect(errorOf(() => replay(['api/project_analyses/search', { status: 199, body: '{"analyses":[]}' }]).sonar.analysisFor(SHA, BRANCH))).toBe('SonarQube GET api/project_analyses/search answered 199: {"analyses":[]}');
    expect(errorOf(() => replay(['api/project_analyses/search', { status: 300, body: '{"analyses":[]}' }]).sonar.analysisFor(SHA, BRANCH))).toMatch(/answered 300/);
    const edge = (status: number) => replay(['api/project_analyses/search', { status, body: recorded('analyses-head.json') }]).sonar.analysisFor(SHA, BRANCH).state;
    expect([edge(200), edge(299)]).toEqual(['done', 'done']);
  });

  it('cuts a long error reply short', () => {
    const { sonar } = replay(['api/project_analyses/search', { status: 500, body: 'x'.repeat(400) }]);
    expect(errorOf(() => sonar.analysisFor(SHA, BRANCH))).toBe(`SonarQube GET api/project_analyses/search answered 500: ${'x'.repeat(300)}…`);
    const { sonar: exact } = replay(['api/project_analyses/search', { status: 500, body: 'y'.repeat(300) }]);
    expect(errorOf(() => exact.analysisFor(SHA, BRANCH))).toBe(`SonarQube GET api/project_analyses/search answered 500: ${'y'.repeat(300)}`);
  });

  it('keeps the token out of the error when no reply came', () => {
    const sonar = sonarQubeAdapter(CONFIG, () => { throw new Error(`proxy refused Basic ${BASIC} for ${TOKEN}`); }, { SONAR_TOKEN: TOKEN });
    expect(errorOf(() => sonar.analysisFor(SHA, BRANCH))).toBe('SonarQube GET api/project_analyses/search: proxy refused Basic [redacted] for [redacted]');
  });
});

describe('sonarQubeAdapter: the analysis of a branch commit', () => {
  it('is done when one of the branch’s newest analyses names the commit as its revision', () => {
    const { sonar, requests } = replay(['api/project_analyses/search', ok('analyses-head.json')]);
    expect(sonar.analysisFor(SHA, BRANCH)).toEqual({ state: 'done', analysisId: 'AZJ3kq0x9Rr2vT1mLw5a', date: '2026-10-06T09:41:12+0000', boundBy: 'revision' });
    expect(requests).toHaveLength(1);
    expect(query(requests[0]!)).toEqual({ project: 'fabrikam-web', branch: 'dev', ps: '20' });
  });

  it('finds an older analysis of the commit too, when newer ones are of later commits', () => {
    const { sonar } = replay(['api/project_analyses/search', ok('analyses-head.json')]);
    expect(sonar.analysisFor(OLD, BRANCH)).toMatchObject({ state: 'done', analysisId: 'AZJ3hT7c4Wq8nB2dKe1f' });
  });

  it('is stale, never done, when only an older commit was analysed and nothing runs, naming that commit', () => {
    const { sonar, requests } = replay(['api/project_analyses/search', ok('analyses-older-commit.json')], ['api/ce/component', ok('ce-component-idle.json')]);
    expect(sonar.analysisFor(SHA, BRANCH)).toEqual({ state: 'stale', revision: OLD, date: '2026-10-06T08:02:47+0000' });
    expect(query(requests[1]!)).toEqual({ component: 'fabrikam-web' });
  });

  it('is running while a task for the branch is queued or in progress', () => {
    expect(replay(['api/project_analyses/search', ok('analyses-older-commit.json')], ['api/ce/component', ok('ce-component-running.json')]).sonar.analysisFor(SHA, BRANCH)).toEqual({ state: 'running' });
  });

  it('is not running for a queued task of another branch or a pull request', () => {
    const { sonar } = replay(['api/project_analyses/search', ok('analyses-older-commit.json')], ['api/ce/component', ok('ce-component-running.json')]);
    expect(sonar.analysisFor(SHA, { branch: 'main' })).toMatchObject({ state: 'stale' });
  });

  it('is failed when the branch’s last task failed', () => {
    expect(replay(['api/project_analyses/search', ok('analyses-older-commit.json')], ['api/ce/component', ok('ce-component-failed.json')]).sonar.analysisFor(SHA, BRANCH)).toEqual({ state: 'failed' });
  });

  it('is not failed for another branch’s failed task, nor for the branch’s successful one', () => {
    expect(replay(['api/project_analyses/search', ok('analyses-older-commit.json')], ['api/ce/component', ok('ce-component-failed.json')]).sonar.analysisFor(SHA, { branch: 'main' })).toMatchObject({ state: 'stale' });
    const noCurrent = { status: 200, body: JSON.stringify({ queue: [] }) };
    expect(replay(['api/project_analyses/search', ok('analyses-older-commit.json')], ['api/ce/component', noCurrent]).sonar.analysisFor(SHA, BRANCH)).toMatchObject({ state: 'stale' });
  });

  it('is none when the branch has no analysis and nothing runs', () => {
    expect(replay(['api/project_analyses/search', ok('analyses-none.json')], ['api/ce/component', ok('ce-component-idle.json')]).sonar.analysisFor(SHA, BRANCH)).toEqual({ state: 'none' });
  });

  it('names an analysis without a revision as of an unknown commit', () => {
    const body = JSON.stringify({ analyses: [{ key: 'A1', date: '2026-10-01T00:00:00+0000' }] });
    expect(replay(['api/project_analyses/search', { status: 200, body }], ['api/ce/component', ok('ce-component-idle.json')]).sonar.analysisFor(SHA, BRANCH)).toEqual({ state: 'stale', revision: 'unknown', date: '2026-10-01T00:00:00+0000' });
  });

  it('refuses a SHA that is not a full commit id, asking nothing', () => {
    const { sonar, requests } = replay();
    expect(() => sonar.analysisFor('HEAD', BRANCH)).toThrow('SonarQube is read for a full 40-character SHA, not "HEAD"');
    expect(() => sonar.analysisFor(`${SHA}0`, BRANCH)).toThrow(/full 40-character SHA/);
    expect(() => sonar.analysisFor(`x${SHA.slice(1)}`, BRANCH)).toThrow(/full 40-character SHA/);
    expect(requests).toEqual([]);
  });
});

describe('sonarQubeAdapter: the analysis of a pull request commit', () => {
  it('is done when the task the scanner submitted for the commit succeeded, with that task’s analysis', () => {
    const { sonar, requests } = replay(['api/ce/task', ok('ce-task-success.json')]);
    expect(sonar.analysisFor(SHA, PR)).toEqual({ state: 'done', analysisId: 'AZJ3kq0x9Rr2vT1mLw5a', date: '2026-10-06T09:41:12+0000', boundBy: 'task' });
    expect(requests.map(query)).toEqual([{ id: 'AZJ3kpZ1Lm2Nn3Oo4Pp5' }]);
  });

  it('is running while the task is in progress or pending', () => {
    expect(replay(['api/ce/task', ok('ce-task-in-progress.json')]).sonar.analysisFor(SHA, PR)).toEqual({ state: 'running' });
    const pending = JSON.parse(recorded('ce-task-in-progress.json')) as { task: { status: string } };
    pending.task.status = 'PENDING';
    expect(replay(['api/ce/task', { status: 200, body: JSON.stringify(pending) }]).sonar.analysisFor(SHA, PR)).toEqual({ state: 'running' });
  });

  it.each(['FAILED', 'CANCELED', 'toString'])('is failed for a task %s', (status) => {
    const task = JSON.parse(recorded('ce-task-failed.json')) as { task: { status: string } };
    task.task.status = status;
    expect(replay(['api/ce/task', { status: 200, body: JSON.stringify(task) }]).sonar.analysisFor(SHA, PR)).toEqual({ state: 'failed' });
  });

  it('is failed, not done, for a failed task that names an analysis', () => {
    const task = JSON.parse(recorded('ce-task-failed.json')) as { task: Record<string, unknown> };
    task.task.analysisId = 'AZJ3kq0x9Rr2vT1mLw5a';
    expect(replay(['api/ce/task', { status: 200, body: JSON.stringify(task) }]).sonar.analysisFor(SHA, PR)).toEqual({ state: 'failed' });
  });

  it('is failed for a successful task without an analysis', () => {
    const task = JSON.parse(recorded('ce-task-success.json')) as { task: Record<string, unknown> };
    delete task.task.analysisId;
    expect(replay(['api/ce/task', { status: 200, body: JSON.stringify(task) }]).sonar.analysisFor(SHA, PR)).toEqual({ state: 'failed' });
  });

  it('keeps an empty date when the task names no end time', () => {
    const task = JSON.parse(recorded('ce-task-success.json')) as { task: Record<string, unknown> };
    delete task.task.executedAt;
    expect(replay(['api/ce/task', { status: 200, body: JSON.stringify(task) }]).sonar.analysisFor(SHA, PR)).toMatchObject({ state: 'done', date: '' });
  });

  it.each([
    ['another pull request', { pullRequest: '41' }, 'fabrikam-web pull request 41'],
    ['a branch', { pullRequest: undefined, branch: 'dev' }, 'fabrikam-web pull request (none)'],
    ['another project', { componentKey: 'contoso-api' }, 'contoso-api pull request 42'],
  ])('could not run when the task is of %s', (_name, change, of) => {
    const task = JSON.parse(recorded('ce-task-success.json')) as { task: Record<string, unknown> };
    Object.assign(task.task, change);
    const { sonar } = replay(['api/ce/task', { status: 200, body: JSON.stringify(task) }]);
    expect(() => sonar.analysisFor(SHA, PR)).toThrow(`SonarQube task AZJ3kpZ1Lm2Nn3Oo4Pp5 is of ${of}, not fabrikam-web pull request 42`);
  });

  it('is unbound, asking nothing, for a pull request without the scanner’s task', () => {
    const { sonar, requests } = replay();
    expect(sonar.analysisFor(SHA, { pullRequest: '42' })).toEqual({ state: 'unbound' });
    expect(requests).toEqual([]);
  });
});

describe('sonarQubeAdapter: the quality gate', () => {
  it('reads one analysis’s quality gate by its id, with its conditions', () => {
    const { sonar, requests } = replay(['api/qualitygates/project_status', ok('qualitygate-error.json')]);
    expect(sonar.qualityGate({ analysisId: 'AZJ3kq0x9Rr2vT1mLw5a' })).toEqual({
      status: 'ERROR',
      conditions: [
        { metric: 'new_violations', status: 'ERROR', comparator: 'GT', threshold: '0', actual: '6' },
        { metric: 'new_coverage', status: 'ERROR', comparator: 'LT', threshold: '80', actual: '51.21951219512195' },
        { metric: 'new_duplicated_lines_density', status: 'ERROR', comparator: 'GT', threshold: '3', actual: '7.4' },
        { metric: 'new_security_hotspots_reviewed', status: 'OK', comparator: 'LT', threshold: '100', actual: '100.0' },
      ],
    });
    expect(requests.map(query)).toEqual([{ analysisId: 'AZJ3kq0x9Rr2vT1mLw5a' }]);
  });

  it('reads a pull request’s or a branch’s latest quality gate by the project key', () => {
    const { sonar, requests } = replay(['api/qualitygates/project_status', ok('qualitygate-ok.json')]);
    expect(sonar.qualityGate(PR).status).toBe('OK');
    sonar.qualityGate(BRANCH);
    expect(requests.map(query)).toEqual([
      { projectKey: 'fabrikam-web', pullRequest: '42' },
      { projectKey: 'fabrikam-web', branch: 'dev' },
    ]);
  });

  it('is NONE with no conditions when the project has no quality gate', () => {
    expect(replay(['api/qualitygates/project_status', ok('qualitygate-none.json')]).sonar.qualityGate({ analysisId: 'A' })).toEqual({ status: 'NONE', conditions: [] });
    const bare = { status: 200, body: JSON.stringify({ projectStatus: { status: 'NONE' } }) };
    expect(replay(['api/qualitygates/project_status', bare]).sonar.qualityGate({ analysisId: 'A' })).toEqual({ status: 'NONE', conditions: [] });
  });

  it('keeps a condition without a threshold or value as empty text', () => {
    const body = JSON.stringify({ projectStatus: { status: 'OK', conditions: [{ status: 'OK', metricKey: 'reopened_issues', comparator: 'GT' }] } });
    expect(replay(['api/qualitygates/project_status', { status: 200, body }]).sonar.qualityGate({ analysisId: 'A' }).conditions).toEqual([{ metric: 'reopened_issues', status: 'OK', comparator: 'GT', threshold: '', actual: '' }]);
  });
});

describe('sonarQubeAdapter: new issues', () => {
  it('reads the new-code issues of each type, the path without the project key, fixed ones left out', () => {
    const { sonar, requests } = replay(['api/issues/search', ok('issues-new.json')]);
    const issues = sonar.newIssues(PR);
    expect(issues.map((i) => [i.key, i.rule, i.type, i.file, i.line])).toEqual([
      ['AZJ3kr-bug-1', 'typescript:S2259', 'BUG', 'src/report/export.ts', 48],
      ['AZJ3kr-vul-1', 'secrets:S6338', 'VULNERABILITY', 'src/report/client.ts', 12],
      ['AZJ3kr-sml-1', 'typescript:S3776', 'CODE_SMELL', 'src/report/export.ts', 21],
      ['AZJ3kr-dup-1', 'common-ts:DuplicatedBlocks', 'CODE_SMELL', 'src/report/format.ts', undefined],
      ['AZJ3kr-sml-2', 'typescript:S1854', 'CODE_SMELL', 'src/report/format.ts', 33],
      ['AZJ3kr-fp-1', 'typescript:S4123', 'BUG', 'src/report/client.ts', 30],
    ]);
    expect(issues[0]).toEqual({
      key: 'AZJ3kr-bug-1',
      rule: 'typescript:S2259',
      type: 'BUG',
      severity: 'MAJOR',
      impacts: [{ softwareQuality: 'RELIABILITY', severity: 'HIGH' }],
      file: 'src/report/export.ts',
      line: 48,
      message: 'TypeError can be thrown as "rows" might be null or undefined here.',
      status: 'OPEN',
      resolution: undefined,
      issueStatus: 'OPEN',
    });
    expect(issues[5]).toMatchObject({ resolution: 'FALSE-POSITIVE', issueStatus: 'FALSE_POSITIVE' });
    expect(requests.map(query)).toEqual([{ components: 'fabrikam-web', pullRequest: '42', inNewCodePeriod: 'true', ps: '500', p: '1' }]);
  });

  it('reads a branch’s, and none is none', () => {
    const { sonar, requests } = replay(['api/issues/search', ok('issues-none.json')]);
    expect(sonar.newIssues(BRANCH)).toEqual([]);
    expect(query(requests[0]!)).toMatchObject({ branch: 'dev' });
  });

  it('keeps an issue on a component outside the project key as named, and no impacts as none', () => {
    const body = JSON.stringify({ paging: { total: 1 }, issues: [{ key: 'K', rule: 'r', component: 'other:src/x.ts', message: 'm', status: 'OPEN' }] });
    expect(replay(['api/issues/search', { status: 200, body }]).sonar.newIssues(BRANCH)[0]).toMatchObject({ file: 'other:src/x.ts', impacts: [] });
    const prefixed = JSON.stringify({ paging: { total: 1 }, issues: [{ key: 'K', rule: 'r', component: 'fabrikam-webx:src/x.ts', message: 'm', status: 'OPEN' }] });
    expect(replay(['api/issues/search', { status: 200, body: prefixed }]).sonar.newIssues(BRANCH)[0]!.file).toBe('fabrikam-webx:src/x.ts');
  });

  it.each([
    ['CLOSED', undefined],
    ['RESOLVED', 'FIXED'],
    ['RESOLVED', 'REMOVED'],
  ])('leaves out an issue with status %s and resolution %s: it is gone from the code', (status, resolution) => {
    const body = JSON.stringify({ paging: { total: 1 }, issues: [{ key: 'K', rule: 'r', component: 'fabrikam-web:a.ts', message: 'm', status, resolution }] });
    expect(replay(['api/issues/search', { status: 200, body }]).sonar.newIssues(BRANCH)).toEqual([]);
  });

  it('reads every page until it has the total', () => {
    const page = (n: number, count: number) => ({ status: 200, body: JSON.stringify({ paging: { pageIndex: n, pageSize: 500, total: 1001 }, issues: Array.from({ length: count }, (_, i) => ({ key: `I${n}-${i}`, rule: 'r', component: 'fabrikam-web:a.ts', message: 'm', status: 'OPEN' })) }) });
    const { sonar, requests } = replay(['api/issues/search', (req) => (query(req).p === '3' ? page(3, 1) : page(Number(query(req).p), 500))]);
    expect(sonar.newIssues(BRANCH)).toHaveLength(1001);
    expect(requests.map((r) => query(r).p)).toEqual(['1', '2', '3']);
  });

  it('stops at a short page, whatever the total says', () => {
    const short = { status: 200, body: JSON.stringify({ paging: { total: 900 }, issues: [{ key: 'I', rule: 'r', component: 'fabrikam-web:a.ts', message: 'm', status: 'OPEN' }] }) };
    const { sonar, requests } = replay(['api/issues/search', short]);
    expect(sonar.newIssues(BRANCH)).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('stops at a full page that reaches the total', () => {
    const full = { status: 200, body: JSON.stringify({ paging: { total: 500 }, issues: Array.from({ length: 500 }, (_, i) => ({ key: `I${i}`, rule: 'r', component: 'fabrikam-web:a.ts', message: 'm', status: 'OPEN' })) }) };
    const { sonar, requests } = replay(['api/issues/search', full]);
    expect(sonar.newIssues(BRANCH)).toHaveLength(500);
    expect(requests).toHaveLength(1);
  });

  it('stops after 20 pages, the 10,000 issues SonarQube answers at most', () => {
    const full = { status: 200, body: JSON.stringify({ paging: { total: 20000 }, issues: Array.from({ length: 500 }, (_, i) => ({ key: `I${i}`, rule: 'r', component: 'fabrikam-web:a.ts', message: 'm', status: 'OPEN' })) }) };
    const { sonar, requests } = replay(['api/issues/search', full]);
    expect(sonar.newIssues(BRANCH)).toHaveLength(10000);
    expect(requests).toHaveLength(20);
  });
});

describe('sonarQubeAdapter: new-code measures', () => {
  it('reads coverage, duplication and issue counts on new code as numbers', () => {
    const { sonar, requests } = replay(['api/measures/component', ok('measures-new-code.json')]);
    expect(sonar.newCodeMeasures(PR)).toEqual({
      new_coverage: 51.21951219512195,
      new_duplicated_lines_density: 7.4,
      new_violations: 6,
      new_bugs: 1,
      new_vulnerabilities: 1,
      new_code_smells: 4,
      new_security_hotspots: 0,
      new_lines: 82,
    });
    expect(requests.map(query)).toEqual([{ component: 'fabrikam-web', pullRequest: '42', metricKeys: NEW_CODE_METRICS.join(',') }]);
  });

  it('reads the older "periods" form and a plain value, and leaves out what is not a number', () => {
    const measures = [
      { metric: 'new_coverage', periods: [{ index: 1, value: '75.0' }] },
      { metric: 'new_lines', value: '12' },
      { metric: 'new_bugs', period: { value: '2' }, value: '9' },
      { metric: 'new_violations', periods: [] },
      { metric: 'new_code_smells' },
      { metric: 'new_security_hotspots', value: 'n/a' },
    ];
    const body = JSON.stringify({ component: { measures } });
    expect(replay(['api/measures/component', { status: 200, body }]).sonar.newCodeMeasures(BRANCH)).toEqual({ new_coverage: 75, new_lines: 12, new_bugs: 2 });
  });

  it('asks for the new-code metrics the quality gate and the comparison need', () => {
    expect(NEW_CODE_METRICS).toEqual(['new_coverage', 'new_duplicated_lines_density', 'new_violations', 'new_bugs', 'new_vulnerabilities', 'new_code_smells', 'new_security_hotspots', 'new_lines']);
  });
});

describe('awaitAnalysis', () => {
  /** A fake clock: sleeping moves time on, nothing waits for real. */
  function clock() {
    let t = 1_000;
    const slept: number[] = [];
    return { slept, now: () => t, sleep: (ms: number) => void (slept.push(ms), (t += ms)) };
  }
  const looks = (...states: AnalysisLook[]) => {
    const asked: string[] = [];
    return { asked, analysisFor: (sha: string, ref: SonarRef) => (asked.push(`${sha.slice(0, 4)} ${JSON.stringify(ref)}`), states.shift() ?? states.at(-1)!) };
  };
  const DONE: AnalysisLook = { state: 'done', analysisId: 'A', date: 'd', boundBy: 'revision' };

  it('looks every 10 seconds while the analysis runs, and returns it once done', () => {
    const c = clock();
    const sonar = looks({ state: 'running' }, { state: 'stale', revision: OLD, date: 'd' }, { state: 'none' }, DONE);
    expect(awaitAnalysis(sonar, SHA, BRANCH, 5, c)).toEqual(DONE);
    expect(c.slept).toEqual([10_000, 10_000, 10_000]);
    expect(sonar.asked).toEqual(Array(4).fill('4c1e {"branch":"dev"}'));
  });

  it('returns a failed or unbound analysis at once: waiting does not change it', () => {
    for (const state of ['failed', 'unbound'] as const) {
      const c = clock();
      expect(awaitAnalysis(looks({ state }), SHA, BRANCH, 5, c)).toEqual({ state });
      expect(c.slept).toEqual([]);
    }
  });

  it('gives the last look, still running, once the minutes have passed', () => {
    const c = clock();
    const sonar = { analysisFor: (): AnalysisLook => ({ state: 'running' }) };
    expect(awaitAnalysis(sonar, SHA, BRANCH, 1, c)).toEqual({ state: 'running' });
    expect(c.slept).toEqual(Array(6).fill(10_000));
  });

  it('looks once and does not sleep with no minutes to wait', () => {
    const c = clock();
    const sonar = looks({ state: 'stale', revision: OLD, date: 'd' });
    expect(awaitAnalysis(sonar, SHA, BRANCH, 0, c)).toEqual({ state: 'stale', revision: OLD, date: 'd' });
    expect(c.slept).toEqual([]);
    expect(sonar.asked).toHaveLength(1);
  });
});
