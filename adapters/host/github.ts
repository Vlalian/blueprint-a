// The GitHub host adapter (ticket 54): the host calls through the gh CLI. CI on one exact commit is
// read from GitHub's check runs (Actions and other apps) and commit statuses (older integrations);
// a PR is opened as a draft or the open one reused; issues stand in for work items. gh is passed
// in, so tests use a fake; scripts/ship-io.ts wires in the real one.

import { needFullSha, snapshotOf, type CheckVerdict, type CiSnapshot, type HostAdapter, type OpenedPr, type PrStatus, type WorkItem } from './host.ts';
import { ghOutput, type ProcessResult } from './process-result.ts';

export type { CiSnapshot, CiState } from './host.ts';
export { isFullSha } from './host.ts';

export type Gh = (args: string[]) => ProcessResult;

type CheckRuns = { check_runs: Array<{ name: string; status: string; conclusion: string | null }> };
type Statuses = { statuses: Array<{ context: string; state: string }> };

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const STATUS_VERDICT: Record<string, CheckVerdict> = { success: 'passed', pending: 'pending' };

const runVerdict = (r: CheckRuns['check_runs'][number]): CheckVerdict =>
  r.status !== 'completed' ? 'pending' : PASSING_CONCLUSIONS.has(String(r.conclusion)) ? 'passed' : 'failing';
// Any other state (failure, error, or one GitHub adds later) is failing, never passed.
const statusVerdict = (s: Statuses['statuses'][number]): CheckVerdict => STATUS_VERDICT[s.state] ?? 'failing';

export function readCi(sha: string, runs: CheckRuns, statuses: Statuses): CiSnapshot {
  return snapshotOf(sha, [...runs.check_runs.map((r) => [r.name, runVerdict(r)] as const), ...statuses.statuses.map((s) => [s.context, statusVerdict(s)] as const)]);
}

/** The two gh calls: check runs and combined commit statuses of that commit ({owner}/{repo} is filled in by gh). */
export function ciQueries(sha: string): [string[], string[]] {
  const api = (path: string) => ['api', '-X', 'GET', `repos/{owner}/{repo}/commits/${sha}/${path}`, '-f', 'per_page=100'];
  return [api('check-runs'), api('status')];
}

export function queryCi(sha: string, gh: Gh): CiSnapshot {
  needFullSha(sha);
  const [runs, statuses] = ciQueries(sha).map((args) => JSON.parse(ghOutput(gh(args), 'gh api')));
  return readCi(sha, runs, statuses);
}

const call = (gh: Gh, args: string[]) => ghOutput(gh(args), `gh ${args[0]} ${args[1]}`);

type ListedPr = { number: number; url: string; isDraft: boolean };

function openDraftPr(gh: Gh, branch: string, base: string, title: string, body: string): OpenedPr {
  const found = (JSON.parse(call(gh, ['pr', 'list', '--head', branch, '--base', base, '--state', 'open', '--json', 'number,url,isDraft', '--limit', '1'])) as ListedPr[])[0];
  if (found) return { id: found.number, url: found.url, created: false, draft: found.isDraft };
  const printed = call(gh, ['pr', 'create', '--draft', '--base', base, '--head', branch, '--title', title, '--body', body]);
  const url = printed.trim().split('\n').at(-1)!;
  const number = /\/pull\/(\d+)$/.exec(url)?.[1];
  if (!number) throw new Error(`gh pr create printed no PR URL: ${printed.trim()}`);
  return { id: Number(number), url, created: true, draft: true };
}

type ViewedPr = { number: number; url: string; state: PrStatus['state']; isDraft: boolean; headRefOid: string };

function prStatus(gh: Gh, id: string): PrStatus {
  const v = JSON.parse(call(gh, ['pr', 'view', id, '--json', 'number,url,state,isDraft,headRefOid'])) as ViewedPr;
  // Branch protection's required checks are check runs on the head commit, which checksForCommit reads.
  return { id: v.number, url: v.url, state: v.state, draft: v.isDraft, head: v.headRefOid, policies: { passed: [], failing: [], pending: [] } };
}

function workItem(gh: Gh, id: number): WorkItem {
  const issue = JSON.parse(call(gh, ['issue', 'view', String(id), '--json', 'number,title,state'])) as { number: number; title: string; state: string };
  return { id: issue.number, title: issue.title, state: issue.state, type: 'issue' };
}

const ISSUE_VERBS: Record<string, string> = { closed: 'close', open: 'reopen' };

function setWorkItemState(gh: Gh, id: number, state: string): WorkItem {
  const verb = ISSUE_VERBS[state.toLowerCase()];
  if (verb === undefined) throw new Error(`a GitHub issue is open or closed, not ${JSON.stringify(state)}`);
  call(gh, ['issue', verb, String(id)]);
  return workItem(gh, id);
}

export function githubHost(gh: Gh): HostAdapter {
  return {
    host: 'github',
    checksForCommit: (sha) => queryCi(sha, gh),
    openDraftPr: (branch, base, title, body) => openDraftPr(gh, branch, base, title, body),
    prStatus: (id) => prStatus(gh, id),
    workItem: (id) => workItem(gh, id),
    setWorkItemState: (id, state) => setWorkItemState(gh, id, state),
  };
}
