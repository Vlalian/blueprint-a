// The Azure DevOps host adapter (ticket 54): the host calls through Azure DevOps' REST API,
// api-version 7.1 (docs: https://learn.microsoft.com/rest/api/azure/devops/; the spike and what is
// still unverified are in README.md beside this file). CI on a commit is its pipeline runs (Builds -
// List, newest first, the newest run of each pipeline on that exact commit); a PR is opened as a
// draft in Azure Repos and never set to complete itself; its required policies are read from the
// policy evaluations; work items are read and moved on Azure Boards.
// The personal access token comes from the AZURE_DEVOPS_PAT environment variable only, goes out
// only in the Authorization header, and is cut out of every error before it is thrown.

import { needFullSha, snapshotOf, sortChecks, type CheckVerdict, type CiSnapshot, type HostAdapter, type OpenedPr, type PrStatus, type WorkItem } from './host.ts';
import { redact, type HttpClient, type HttpReply, type HttpRequest } from './http.ts';

export interface AzureDevOpsConfig {
  organization: string;
  project: string;
  /** The Azure Repos repository PRs are opened in, by name or id. */
  repository: string;
}

export const PAT_VARIABLE = 'AZURE_DEVOPS_PAT';
export const AZURE_API = '7.1';
/** Evaluations - List is only published as a preview. */
export const POLICY_API = '7.1-preview.1';
/** How many of the project's newest builds are searched for the commit's runs. */
const BUILDS_SEARCHED = '200';
const ERROR_CHARS = 300;

type Query = Record<string, string>;
type Call = (method: HttpRequest['method'], path: string, query: Query, body?: { type: string; data: unknown }) => unknown;

const enc = encodeURIComponent;

function snippet(text: string): string {
  return text.length > ERROR_CHARS ? `${text.slice(0, ERROR_CHARS)}…` : text;
}

/** The request: basic auth with an empty user name, api-version 7.1 unless the query names another. */
function requestOf(root: string, basic: string, method: HttpRequest['method'], path: string, query: Query, body?: { type: string; data: unknown }): HttpRequest {
  const url = `${root}${path}?${new URLSearchParams({ 'api-version': AZURE_API, ...query })}`;
  const headers = { Authorization: `Basic ${basic}`, Accept: 'application/json' };
  return body ? { method, url, headers: { ...headers, 'Content-Type': body.type }, body: JSON.stringify(body.data) } : { method, url, headers };
}

/** The reply's JSON, or why there is none: the error status, or no JSON at all. */
function answerOf(reply: HttpReply): { json: unknown } | { why: string } {
  if (reply.status < 200 || reply.status > 299) return { why: ` answered ${reply.status}: ${snippet(reply.body)}` };
  try {
    return { json: JSON.parse(reply.body) };
  } catch {
    // A missing or expired token can be answered with the sign-in page, status 203, instead of 401.
    return { why: ` answered ${reply.status} with no JSON: ${snippet(reply.body)}` };
  }
}

/** The reply, or why none came. */
function send(http: HttpClient, request: HttpRequest): HttpReply | { why: string } {
  try {
    return http(request);
  } catch (e) {
    return { why: `: ${(e as Error).message}` };
  }
}

/** The JSON of a 2xx reply; anything else (an error status, the sign-in page, no reply) throws, the PAT cut out. */
function caller(config: AzureDevOpsConfig, http: HttpClient, pat: string): Call {
  const basic = Buffer.from(`:${pat}`).toString('base64');
  const root = `https://dev.azure.com/${enc(config.organization)}/${enc(config.project)}/_apis/`;
  return (method, path, query, body) => {
    const sent = send(http, requestOf(root, basic, method, path, query, body));
    const answer = 'why' in sent ? sent : answerOf(sent);
    if ('why' in answer) throw new Error(redact(`Azure DevOps ${method} ${path}${answer.why}`, [pat, basic]));
    return answer.json;
  };
}

type Build = { status: string; result: string | null; sourceVersion: string; definition: { name: string } };

const buildVerdict = (b: Build): CheckVerdict => (b.status !== 'completed' ? 'pending' : b.result === 'succeeded' ? 'passed' : 'failing');

/** The newest run of each pipeline on the commit (the list is newest first), as GitHub reads the latest check run of each name. */
function checksForCommit(call: Call, sha: string): CiSnapshot {
  needFullSha(sha);
  const builds = (call('GET', 'build/builds', { queryOrder: 'queueTimeDescending', $top: BUILDS_SEARCHED }) as { value: Build[] }).value;
  const newest = new Map<string, Build>();
  for (const b of builds.filter((b) => b.sourceVersion === sha)) if (!newest.has(b.definition.name)) newest.set(b.definition.name, b);
  return snapshotOf(sha, [...newest].map(([name, b]) => [name, buildVerdict(b)] as const));
}

type Pr = { pullRequestId: number; status: string; isDraft: boolean; lastMergeSourceCommit: { commitId: string }; repository: { project: { id: string } } };

const prUrl = (config: AzureDevOpsConfig, id: number) => `https://dev.azure.com/${enc(config.organization)}/${enc(config.project)}/_git/${enc(config.repository)}/pullrequest/${id}`;
const heads = (branch: string) => `refs/heads/${branch}`;

function openDraftPr(call: Call, config: AzureDevOpsConfig, branch: string, base: string, title: string, body: string): OpenedPr {
  const prs = `git/repositories/${enc(config.repository)}/pullrequests`;
  const search = { 'searchCriteria.sourceRefName': heads(branch), 'searchCriteria.targetRefName': heads(base), 'searchCriteria.status': 'active', $top: '1' };
  const found = (call('GET', prs, search) as { value: Pr[] }).value[0];
  if (found) return { id: found.pullRequestId, url: prUrl(config, found.pullRequestId), created: false, draft: found.isDraft };
  // Only these fields: no autoCompleteSetBy and no completionOptions, so the PR never completes itself.
  const data = { sourceRefName: heads(branch), targetRefName: heads(base), title, description: body, isDraft: true };
  const pr = call('POST', prs, {}, { type: 'application/json', data }) as Pr;
  return { id: pr.pullRequestId, url: prUrl(config, pr.pullRequestId), created: true, draft: pr.isDraft };
}

const PR_STATES: Record<string, PrStatus['state']> = { active: 'OPEN', abandoned: 'CLOSED', completed: 'MERGED' };
const POLICY_VERDICTS: Record<string, CheckVerdict> = { approved: 'passed', queued: 'pending', running: 'pending', rejected: 'failing', broken: 'failing' };

type Evaluation = { status: string; configuration: { isEnabled: boolean; isBlocking: boolean; type: { displayName: string } } };

/** The enabled, blocking policies that apply to the PR, by verdict. */
function policiesOf(call: Call, projectId: string, id: number): PrStatus['policies'] {
  const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectId}/${id}`;
  const evaluations = (call('GET', 'policy/evaluations', { artifactId, 'api-version': POLICY_API }) as { value: Evaluation[] }).value;
  const counted = evaluations.filter((e) => e.configuration.isEnabled && e.configuration.isBlocking && e.status in POLICY_VERDICTS);
  return sortChecks(counted.map((e) => [e.configuration.type.displayName, POLICY_VERDICTS[e.status]!] as const));
}

function prStatus(call: Call, config: AzureDevOpsConfig, id: string): PrStatus {
  if (!/^\d+$/.test(id)) throw new Error(`an Azure DevOps PR is named by its number, not ${JSON.stringify(id)}`);
  const pr = call('GET', `git/repositories/${enc(config.repository)}/pullrequests/${id}`, {}) as Pr;
  const state = PR_STATES[pr.status];
  if (state === undefined) throw new Error(`Azure DevOps PR ${id} has status ${JSON.stringify(pr.status)}`);
  const policies = policiesOf(call, pr.repository.project.id, pr.pullRequestId);
  return { id: pr.pullRequestId, url: prUrl(config, pr.pullRequestId), state, draft: pr.isDraft, head: pr.lastMergeSourceCommit.commitId, policies };
}

type Item = { id: number; fields: Record<string, string> };

const itemOf = (i: Item): WorkItem => ({ id: i.id, title: i.fields['System.Title']!, state: i.fields['System.State']!, type: i.fields['System.WorkItemType']! });

export function azureDevOpsHost(config: AzureDevOpsConfig, http: HttpClient, env: Record<string, string | undefined>): HostAdapter {
  const pat = env[PAT_VARIABLE];
  if (!pat) throw new Error(`${PAT_VARIABLE} is not set: the Azure DevOps host reads its personal access token from that environment variable only`);
  const call = caller(config, http, pat);
  return {
    host: 'azure-devops',
    checksForCommit: (sha) => checksForCommit(call, sha),
    openDraftPr: (branch, base, title, body) => openDraftPr(call, config, branch, base, title, body),
    prStatus: (id) => prStatus(call, config, id),
    workItem: (id) => itemOf(call('GET', `wit/workitems/${id}`, { fields: 'System.Title,System.State,System.WorkItemType' }) as Item),
    setWorkItemState: (id, state) =>
      itemOf(call('PATCH', `wit/workitems/${id}`, {}, { type: 'application/json-patch+json', data: [{ op: 'add', path: '/fields/System.State', value: state }] }) as Item),
  };
}
