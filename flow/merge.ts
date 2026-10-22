// flow merge (ticket 84, from scripts/flow/merge.ts): merges one gated ticket into the integration
// branch after the owner's yes. `--consent <ticket> "<words>"` records the yes, bound to the ticket
// branch's head at that moment. `--review <ticket> <family> <findings.json>` records the review of
// that head by a configured family: every finding, each fixed or declined with a reason.
// `<ticket>` merges only when: a yes is recorded on the branch's current head and not used yet; the
// gate queue's latest result is green on that same head; a review is recorded on that head, by a
// family other than the one that built the round (the last `Builder:` of its Result; 11-optimisations
// item 5), with every finding settled; the integration worktree (<worktreeDir>/integration) is on
// the integration branch and clean apart from untracked run-time files; and the integration branch,
// brought up to date, is the very commit the gate ran on. Then it merges without a commit, runs
// config/flow.json's afterMerge commands, commits by path, pushes, marks the yes used, and merges
// the base into every open ticket branch (base-into.ts). Everything else is refused with the
// reason. With git, the shell and the files injected.

import { baseIntoLines, baseIntoOpen, type BaseIntoIo } from './base-into.ts';
import type { FlowConfig } from './config.ts';
import { latestResult, readGates, type GateResult } from './gate-queue-state.ts';
import { builderIn, flowPath, FLOW_FILES, jsonOf, jsonText, ticketFile, ticketNameOf, worktreePath } from './state.ts';

export interface Consent {
  words: string;
  /** The ticket branch's head the yes was given on. */
  head: string;
  branch: string;
  at: string;
  /** The integration commit it was merged in; a used yes merges nothing again. */
  merged?: string;
}

/** One finding of a review, as the fix round left it. */
export interface ReviewFinding {
  finding: string;
  /** `fixed` or `declined`; anything else is still open. */
  outcome: string;
  /** Why a declined finding stays as it is. */
  reason?: string;
}

export interface ReviewVerdict {
  reviewer: string;
  /** The ticket branch's head the findings were fixed or declined on. */
  head: string;
  branch: string;
  at: string;
  findings: ReviewFinding[];
}

export interface MergeIo extends BaseIntoIo {
  write(path: string, text: string): void;
}

/** The flow's worktree on the integration branch, where merges are made. */
export const integrationWorktree = (c: MergeConfig, io: Pick<MergeIo, 'root'>) => worktreePath(io.root, c, 'integration');

export type MergeConfig = FlowConfig;

/** Where a run writes files into a worktree; only untracked files there never make it unclean. */
export const RUN_TIME = ['state/', '.worktrees/', '.stryker-tmp/', 'reports/'];

/** `git status --porcelain` lines that are not untracked run-time files. */
export function uncleanLines(porcelain: string, c: Pick<FlowConfig, 'stateDir' | 'worktreeDir'>): string[] {
  const runTime = [...RUN_TIME, `${c.stateDir}/`, `${c.worktreeDir}/`];
  return porcelain
    .split(/\r?\n/)
    .filter((l) => l !== '')
    .filter((l) => !(l.startsWith('?? ') && runTime.some((p) => l.slice(3).replaceAll('"', '').startsWith(p))));
}

class Refused extends Error {}

const refuse = (reason: string): never => {
  throw new Refused(reason);
};

const consentsPath = (c: MergeConfig, io: MergeIo) => flowPath(io.root, c, FLOW_FILES.consents);
const readConsents = (c: MergeConfig, io: MergeIo) => jsonOf<Record<string, Consent>>(io.read(consentsPath(c, io)), {}, FLOW_FILES.consents);
const reviewsPath = (c: MergeConfig, io: MergeIo) => flowPath(io.root, c, FLOW_FILES.reviews);
const readReviews = (c: MergeConfig, io: MergeIo) => jsonOf<Record<string, ReviewVerdict>>(io.read(reviewsPath(c, io)), {}, FLOW_FILES.reviews);

function gitOut(io: MergeIo, cwd: string, args: string[], what: string): string {
  const r = io.git(cwd, args);
  return r.status === 0 ? r.stdout.trim() : refuse(`${what} failed: ${(r.stderr || r.stdout).trim()}`);
}

/** The latest gate result of the ticket; refused when it was never gated. */
function gated(ticket: string, c: MergeConfig, io: MergeIo): GateResult {
  return latestResult(readGates(io.read(flowPath(io.root, c, FLOW_FILES.gateQueue))), ticket) ?? refuse(`ticket ${ticket} has no result in the gate queue; run flow gate-queue add <branch>, then run`);
}

/** The ticket's gated branch and its head on the remote now, after a fetch. */
function current(ticket: string, c: MergeConfig, io: MergeIo): { result: GateResult; head: string } {
  gitOut(io, io.root, ['fetch', c.remote], `git fetch ${c.remote}`);
  const result = gated(ticket, c, io);
  const ref = `${c.remote}/${result.branch}`;
  return { result, head: gitOut(io, io.root, ['rev-parse', '--verify', `${ref}^{commit}`], `git rev-parse ${ref}`) };
}

function consent(ticket: string, words: string, c: MergeConfig, io: MergeIo): string {
  if (words.trim() === '') refuse(`a yes needs ${c.owner}'s words: flow merge --consent <ticket> "<words>"`);
  const { result, head } = current(ticket, c, io);
  io.write(consentsPath(c, io), jsonText({ ...readConsents(c, io), [ticket]: { words, head, branch: result.branch, at: io.now() } }));
  return `Recorded ${c.owner}'s yes for ticket ${ticket} on ${result.branch} @ ${head.slice(0, 7)}: "${words}"`;
}

const settled = (f: ReviewFinding) => f.outcome === 'fixed' || (f.outcome === 'declined' && (f.reason ?? '').trim() !== '');

/** The findings in a findings file: a JSON list of objects; refused otherwise. */
function findingsIn(file: string, io: MergeIo): ReviewFinding[] {
  let list: unknown;
  try {
    list = JSON.parse(io.read(file) as string);
  } catch {
    // Missing or not JSON: refused below.
  }
  const objects = Array.isArray(list) && list.every((f) => typeof f === 'object' && f !== null);
  return objects ? (list as ReviewFinding[]) : refuse(`${file} must hold the review's findings as a JSON list of {finding, outcome: "fixed" | "declined", reason}`);
}

function review(ticket: string, family: string, file: string, c: MergeConfig, io: MergeIo): string {
  const reviewer = c.families.find((f) => f.name === family)?.name ?? refuse(`no family ${family} in config/flow.json to have reviewed it`);
  const findings = findingsIn(file, io);
  const { result, head } = current(ticket, c, io);
  io.write(reviewsPath(c, io), jsonText({ ...readReviews(c, io), [ticket]: { reviewer, head, branch: result.branch, at: io.now(), findings } }));
  const open = findings.filter((f) => !settled(f)).length;
  const state = open === 0 ? 'each fixed or declined with a reason' : `${open} not yet fixed or declined with a reason`;
  return `Recorded the ${reviewer} review of ticket ${ticket} on ${result.branch} @ ${head.slice(0, 7)}: ${findings.length} finding(s), ${state}`;
}

/** The family that built the round at `head`, from its ticket file there. */
function builderAt(branch: string, head: string, c: MergeConfig, io: MergeIo): string {
  const file = ticketFile(ticketNameOf(branch, c)!, c);
  return builderIn(io.git(io.root, ['show', `${head}:${file}`]).stdout) ?? refuse(`the Result of ${file} at ${head.slice(0, 7)} names no Builder: <family>, so no other family can be told`);
}

/** Why the recorded review does not let the head merge, or nothing. */
function reviewProblem(ticket: string, branch: string, head: string, c: MergeConfig, io: MergeIo): string | undefined {
  const builder = builderAt(branch, head, c, io);
  const verdict = readReviews(c, io)[ticket];
  const again = `flow merge --review ${ticket} <family> <findings.json>`;
  if (verdict === undefined) return `no review is recorded for ticket ${ticket}; have a family other than ${builder} review it, settle each finding, and record them with ${again}`;
  if (verdict.reviewer === builder) return `no review by the other family: the round ${builder} built was reviewed by ${builder} only`;
  if (verdict.head !== head) return `the review of ticket ${ticket} was recorded on ${verdict.head.slice(0, 7)}, but ${branch} is now at ${head.slice(0, 7)}; record it again with ${again}`;
  const open = verdict.findings.filter((f) => !settled(f));
  if (open.length === 0) return undefined;
  return [`${open.length} finding(s) of the ${verdict.reviewer} review of ticket ${ticket} are neither fixed nor declined with a reason:`, ...open.map((f) => `  - ${f.finding}`)].join('\n');
}

/** Why the gate result does not let the head merge, or nothing. */
function gateProblem(result: GateResult, head: string): string | undefined {
  if (result.head !== head) return `the gate ran on ${result.head.slice(0, 7)}, but ${result.branch} is now at ${head.slice(0, 7)}; gate it again`;
  return result.status === 'green' ? undefined : `the gate on ${head.slice(0, 7)} is ${result.status}${result.stage === undefined ? '' : ` at ${result.stage}`}, not green`;
}

/** A recorded, unused yes for the ticket. */
function yesFor(ticket: string, c: MergeConfig, io: MergeIo): Consent {
  const yes = readConsents(c, io)[ticket] ?? refuse(`no recorded yes from ${c.owner} for ticket ${ticket}; record it with flow merge --consent ${ticket} "<words>"`);
  return yes.merged === undefined ? yes : refuse(`${c.owner}'s yes for ticket ${ticket} was used already: merged in ${yes.merged.slice(0, 7)}`);
}

interface Checked {
  yes: Consent;
  head: string;
  branch: string;
  /** The integration commit the green gate ran on. */
  gatedBase: string;
}

/** The ticket's yes, branch, head and gated base; refused with why it may not merge. */
function checked(ticket: string, c: MergeConfig, io: MergeIo): Checked {
  const yes = yesFor(ticket, c, io);
  const { result, head } = current(ticket, c, io);
  if (yes.head !== head) refuse(`${c.owner}'s yes for ticket ${ticket} was given on ${yes.head.slice(0, 7)}, but ${result.branch} is now at ${head.slice(0, 7)}; ask again`);
  const problem = gateProblem(result, head) ?? reviewProblem(ticket, result.branch, head, c, io);
  if (problem !== undefined) refuse(problem);
  return { yes, head, branch: result.branch, gatedBase: result.base };
}

/** The integration worktree on the integration branch, clean apart from run-time files. */
function worktreeReady(c: MergeConfig, io: MergeIo): void {
  const on = gitOut(io, integrationWorktree(c, io), ['rev-parse', '--abbrev-ref', 'HEAD'], 'git in the integration worktree');
  if (on !== c.integrationBranch) refuse(`the integration worktree ${integrationWorktree(c, io)} is on ${on}, not ${c.integrationBranch}`);
  const unclean = uncleanLines(gitOut(io, integrationWorktree(c, io), ['status', '--porcelain'], 'git status in the integration worktree'), c);
  if (unclean.length > 0) refuse(`the integration worktree is not clean:\n${unclean.join('\n')}`);
}

/** Runs the after-merge commands and commits by path; undoes the merge when a step fails. */
function committed(ticket: string, k: Checked, c: MergeConfig, io: MergeIo): void {
  const wt = integrationWorktree(c, io);
  try {
    gitOut(io, wt, ['merge', '--no-ff', '--no-commit', k.head], `merging ${k.branch}`);
    for (const command of c.afterMerge.commands) if (io.run(command, wt) !== 0) refuse(`the after-merge command ${command} failed`);
    if (c.afterMerge.add.length > 0) gitOut(io, wt, ['add', '--', ...c.afterMerge.add], 'git add of the after-merge files');
    gitOut(io, wt, ['commit', '-q', '-m', `Merge ${k.branch} into ${c.integrationBranch} (ticket ${ticket})\n\n${c.owner}'s yes: "${k.yes.words}" (${k.yes.at})`], 'git commit');
  } catch (e) {
    io.git(wt, ['merge', '--abort']);
    throw e;
  }
}

function merge(ticket: string, c: MergeConfig, io: MergeIo): string {
  const k = checked(ticket, c, io);
  worktreeReady(c, io);
  gitOut(io, integrationWorktree(c, io), ['merge', '--ff-only', `${c.remote}/${c.integrationBranch}`], `bringing ${c.integrationBranch} up to date`);
  const now = gitOut(io, integrationWorktree(c, io), ['rev-parse', '--verify', 'HEAD^{commit}'], `git rev-parse ${c.integrationBranch}`);
  if (now !== k.gatedBase) refuse(`the gate ran on ${c.integrationBranch} at ${k.gatedBase.slice(0, 7)}, but ${c.integrationBranch} is now at ${now.slice(0, 7)}; gate it again`);
  committed(ticket, k, c, io);
  const sha = gitOut(io, integrationWorktree(c, io), ['rev-parse', 'HEAD'], 'git rev-parse HEAD');
  gitOut(io, integrationWorktree(c, io), ['push', c.remote, `HEAD:refs/heads/${c.integrationBranch}`], `pushing ${c.integrationBranch} (the merge ${sha.slice(0, 7)} is committed in the integration worktree)`);
  io.write(consentsPath(c, io), jsonText({ ...readConsents(c, io), [ticket]: { ...k.yes, merged: sha } }));
  const into = baseIntoLines(c.integrationBranch, baseIntoOpen(k.branch, c, io));
  return [`Merged ${k.branch} @ ${k.head.slice(0, 7)} into ${c.integrationBranch} as ${sha.slice(0, 7)} and pushed it.`, ...into].join('\n');
}

const USAGE = 'usage: flow merge <ticket> | --consent <ticket> "<words>" | --review <ticket> <family> <findings.json>\n';

type Command = [arity: number, run: (args: string[], c: MergeConfig, io: MergeIo) => string];

const FLAGGED: Record<string, Command> = {
  '--consent': [2, ([ticket, words], c, io) => consent(ticket!, words!, c, io)],
  '--review': [3, ([ticket, family, file], c, io) => review(ticket!, family!, file!, c, io)],
};
const MERGE: Command = [1, ([ticket], c, io) => merge(ticket!, c, io)];

/** The command the arguments name with exactly its arguments, or undefined. */
function commandOf(argv: string[], c: MergeConfig, io: MergeIo): (() => string) | undefined {
  const [first, ...rest] = argv;
  const flagged = first?.startsWith('-') === true;
  const command = flagged ? FLAGGED[first!] : MERGE;
  const args = flagged ? rest : argv;
  return command !== undefined && args.length === command[0] ? () => command[1](args, c, io) : undefined;
}

/** 0 merged or recorded; 1 refused, with the reason; 2 for the usage. */
export function flowMerge(argv: string[], c: MergeConfig, io: MergeIo): number {
  const run = commandOf(argv, c, io);
  if (run === undefined) return (io.out(USAGE), 2);
  try {
    io.out(`${run()}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    io.out(`Refused: ${e.message}\n`);
    return 1;
  }
}
