// Push a ticket's branch and open a DRAFT pull request for it (blueprint B, tier 2). Never
// ready, never merged, never a push to main: the push runs only when the pre-tool hook's own git
// rules (adapters/claude-code/git-rules.ts) allow it, and the host is only asked to open a draft PR
// (adapters/host, ticket 54: gh on GitHub, the REST API on Azure DevOps). An open PR for the branch
// is reused, so a second call after a fix round only pushes. scripts/pr.ts only wires in git and the
// host the project's "pr" config names.

import { parseArgs } from 'node:util';
import { blockedReason } from '../gates/git-guard/git-rules.ts';
import { hostConfigOf, type HostConfig } from '../adapters/host/config.ts';
import type { HostAdapter } from '../adapters/host/host.ts';
import { stagingOf, type StagingConfig } from './staging.ts';
import type { ProcessResult } from '../adapters/host/process-result.ts';

export type { ProcessResult };

export interface PrIo {
  /** git in the work clone; throws on a failing command. */
  git(args: string[]): string;
  host: Pick<HostAdapter, 'openDraftPr'>;
}

export interface DraftPr {
  branch: string;
  base: string;
  remote: string;
  title: string;
  body: string;
  /** The branch staging is promoted to (decision 22): a draft PR never targets it. */
  promoteTo?: string;
}

export type PrResult =
  | { ok: true; branch: string; sha: string; url: string; number: number; created: boolean; draft: boolean }
  | { ok: false; branch: string; refused?: true; error: string };

const pushArgs = (pr: DraftPr) => ['push', '-u', pr.remote, `refs/heads/${pr.branch}:refs/heads/${pr.branch}`];

/** Why this push is never made, or undefined when the rules allow it. */
function refusalOf(pr: DraftPr): string | undefined {
  // Stryker disable next-line ObjectLiteral: equivalent; the refspec names its destination, so blockedReason never reads the current branch (it does only for HEAD, @ or a bare push)
  const blocked = blockedReason(['git', ...pushArgs(pr)], { currentBranch: pr.branch });
  if (blocked) return blocked;
  if (pr.base === pr.promoteTo) return `draft PRs never target ${pr.base}: promoting to it is the owner’s step`;
  return pr.branch === pr.base ? `the PR branch is its own base (${pr.base})` : undefined;
}

function pushAndOpen(pr: DraftPr, io: PrIo): PrResult {
  const sha = io.git(['rev-parse', '--verify', `refs/heads/${pr.branch}^{commit}`]).trim();
  io.git(pushArgs(pr));
  const open = io.host.openDraftPr(pr.branch, pr.base, pr.title, pr.body);
  return { ok: true, branch: pr.branch, sha, url: open.url, number: open.id, created: open.created, draft: open.draft };
}

export function openDraftPr(pr: DraftPr, io: PrIo): PrResult {
  const refusal = refusalOf(pr);
  if (refusal) return { ok: false, branch: pr.branch, refused: true, error: refusal };
  try {
    return pushAndOpen(pr, io);
  } catch (e) {
    return { ok: false, branch: pr.branch, error: (e as Error).message };
  }
}

const OPTIONS = {
  branch: { type: 'string' },
  title: { type: 'string' },
  body: { type: 'string', default: '' },
  base: { type: 'string' },
  project: { type: 'string' },
  remote: { type: 'string', default: 'origin' },
  cwd: { type: 'string', default: '.' },
} as const;

function need(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} is required. usage: node scripts/pr.ts --branch <name> --title <text> [--body <text>] [--base main] [--project <name>] [--remote origin] [--cwd <repo>]`);
  return value;
}

/** The exit: 0 a draft PR is open, 1 the rules refused the push, 2 could not run. */
const exitOf = (r: PrResult) => (r.ok ? 0 : r.refused ? 1 : 2);

/** Where the draft PR goes (--base, else the --project's integration branch (decision 22), else main) and on which host. */
function targetOf(base: string | undefined, project: string | undefined, readProject?: (name: string) => object): { base: string; promoteTo?: string; host: HostConfig } {
  const config: StagingConfig & { pr?: unknown } = project === undefined ? {} : readProject!(project);
  const staging = stagingOf(config);
  return { base: base ?? staging?.integrationBranch ?? 'main', promoteTo: staging?.promoteTo, host: hostConfigOf(config.pr) };
}

/** One CLI call; `ioIn` gives the I/O for the repo at --cwd on the project's host, `readProject` a project's project.json. */
export function runPr(argv: string[], ioIn: (cwd: string, host: HostConfig) => PrIo, readProject?: (name: string) => object): { json: PrResult | { ok: false; error: string }; exitCode: number } {
  try {
    const { values: o } = parseArgs({ args: argv, options: OPTIONS });
    const draft = { branch: need(o.branch, '--branch'), title: need(o.title, '--title'), body: o.body, remote: o.remote };
    const { host, ...target } = targetOf(o.base, o.project, readProject);
    const r = openDraftPr({ ...draft, ...target }, ioIn(o.cwd, host));
    return { json: r, exitCode: exitOf(r) };
  } catch (e) {
    return { json: { ok: false, error: (e as Error).message }, exitCode: 2 };
  }
}
