// The host adapter (ticket 54): the five calls the CI and PR gates make on wherever the code, the
// pipelines and the boards live. ci-on-sha, the ledger's PR step and the PR watcher read only this
// interface; github.ts answers it through the gh CLI, azure-devops.ts through Azure DevOps' REST
// API. Both read CI on one exact commit into the same snapshot, so a commit's verdict
// (VERIFIED / FAILED / NOT-VERIFIED) means the same on either host.

export type CiState = 'green' | 'failing' | 'pending';

export interface CiSnapshot {
  sha: string;
  state: CiState;
  passed: string[];
  failing: string[];
  pending: string[];
}

/** One check, pipeline run or policy, as the snapshot counts it. */
export type CheckVerdict = 'passed' | 'failing' | 'pending';

/** What CI on a commit says about shipping it, in the ledger's words. */
export type Verdict = 'VERIFIED' | 'FAILED' | 'NOT-VERIFIED';

export interface OpenedPr {
  id: number;
  url: string;
  /** False when an open PR for the branch was found and reused. */
  created: boolean;
  draft: boolean;
}

/** A blocking policy or required check on a PR, by name and verdict. */
export interface Policies {
  passed: string[];
  failing: string[];
  pending: string[];
}

export interface PrStatus {
  id: number;
  url: string;
  /** GitHub's words on both hosts: Azure DevOps' active, abandoned and completed map to these. */
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  draft: boolean;
  /** The PR's head commit. */
  head: string;
  policies: Policies;
}

export interface WorkItem {
  id: number;
  title: string;
  state: string;
  type: string;
}

export interface HostAdapter {
  host: 'github' | 'azure-devops';
  /** CI on one exact commit (a full 40-character SHA); throws when the host cannot be read. */
  checksForCommit(sha: string): CiSnapshot;
  /** Opens a draft PR from branch into base, or reuses the open one; never ready, never set to complete itself. */
  openDraftPr(branch: string, base: string, title: string, body: string): OpenedPr;
  prStatus(id: string): PrStatus;
  workItem(id: number): WorkItem;
  setWorkItemState(id: number, state: string): WorkItem;
}

export const isFullSha = (sha: string) => /^[0-9a-f]{40}$/.test(sha);

/** Throws unless sha is a full SHA: CI is never read for a short one or a ref. */
export function needFullSha(sha: string): void {
  if (!isFullSha(sha)) throw new Error(`CI is read for a full 40-character SHA, not ${JSON.stringify(sha)}`);
}

/** Green only when something reported and everything that reported passed; one failure is failing even while others run; nothing yet is pending. */
function stateOf(c: Omit<CiSnapshot, 'sha' | 'state'>): CiState {
  if (c.failing.length > 0) return 'failing';
  return c.pending.length > 0 || c.passed.length === 0 ? 'pending' : 'green';
}

/** The names under each verdict, in the order given. */
export function sortChecks(checks: ReadonlyArray<readonly [name: string, verdict: CheckVerdict]>): Policies {
  const named = (v: CheckVerdict) => checks.filter(([, verdict]) => verdict === v).map(([name]) => name);
  return { passed: named('passed'), failing: named('failing'), pending: named('pending') };
}

export function snapshotOf(sha: string, checks: ReadonlyArray<readonly [name: string, verdict: CheckVerdict]>): CiSnapshot {
  const c = sortChecks(checks);
  return { sha, state: stateOf(c), ...c };
}

const VERDICTS: Record<CiState, Verdict> = { green: 'VERIFIED', failing: 'FAILED', pending: 'NOT-VERIFIED' };

/** Green is VERIFIED, failing FAILED, anything still running or not yet reported NOT-VERIFIED. */
export const verdictOf = (state: CiState): Verdict => VERDICTS[state];
