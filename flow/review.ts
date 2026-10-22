// flow review (ticket 84, from scripts/flow/review.ts, scripts/codex-review*.ts and
// scripts/codex-io.ts; 11-optimisations item 5): the other family reviews a round. The ticket
// branch's exact head on the remote is reviewed, never a working tree; the family that built it is
// the last `Builder:` line of the ticket's Result there, and the reviewer is a configured family
// other than that one (model-run.ts), `--family` to choose which. The review covers the change
// since the last reviewed head (when it is an ancestor), else since the integration branch. The
// family's review command gets the brief on stdin and {prompt}, {worktree}, {branch}, {head},
// {base}, {ticket} and {out}; it prints the review JSON or writes it to {out}. The JSON must match
// the review schema (gates/review-schema); the validation and an observation are recorded. Exit 0
// for a valid review, 1 otherwise. With git, the model, the files and the clock injected.

import { parseArgs } from 'node:util';
import { REVIEW_SCHEMA, validateReview, type ReviewValidation } from '../gates/review-schema/schema.ts';
import type { Git } from './builds.ts';
import type { FlowConfig } from './config.ts';
import { reviewerFor, runModel, type ModelIo } from './model-run.ts';
import { appendRecords } from './records.ts';
import { builderIn, flowPath, jsonOf, jsonText, nameOfTicket, roundIn, ticketFile } from './state.ts';

export interface ReviewIo extends ModelIo {
  root: string;
  git: Git;
  /** The file names in the ticket folder, a repo path. */
  ticketFiles(folder: string): string[];
  read(path: string): string | undefined;
  write(path: string, text: string): void;
  append(path: string, text: string): void;
  /** Milliseconds, from any fixed point. */
  clock(): number;
  now(): string;
  out(text: string): void;
}

export type ReviewConfig = Pick<FlowConfig, 'families' | 'remote' | 'integrationBranch' | 'branchPrefix' | 'ticketFolder' | 'stateDir'>;

interface Round {
  ticket: string;
  branch: string;
  head: string;
  text: string;
  builder: string;
  reviewer: ReturnType<typeof reviewerFor>;
}

/** git's output; throws naming the step when it fails. */
function gitOut(args: string[], io: ReviewIo): string {
  const r = io.git(io.root, args);
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

const USAGE = 'usage: flow review <ticket> [--family <name>]';

function roundOf(argv: string[], c: ReviewConfig, io: ReviewIo): Round {
  const { positionals, values } = parseArgs({ args: argv, allowPositionals: true, options: { family: { type: 'string' } } });
  if (positionals.length !== 1) throw new Error(USAGE);
  const ticket = positionals[0]!;
  const name = nameOfTicket(io.ticketFiles(c.ticketFolder), ticket);
  if (name === undefined) throw new Error(`no ticket ${ticket} in ${c.ticketFolder}`);
  gitOut(['fetch', c.remote], io);
  const branch = `${c.branchPrefix}${name}`;
  const head = gitOut(['rev-parse', `${c.remote}/${branch}`], io).trim();
  const text = gitOut(['show', `${head}:${ticketFile(name, c)}`], io);
  const builder = builderIn(text);
  if (builder === undefined) throw new Error(`the Result of ${ticketFile(name, c)} on ${branch} names no Builder: <family>`);
  return { ticket, branch, head, text, builder, reviewer: reviewerFor(builder, c, values.family) };
}

const lastReviewed = (ticket: string) => `last-review-${ticket}.json`;

/** The last reviewed head when the branch still holds it, else where the branch left the integration branch. */
function baseOf(r: Round, c: ReviewConfig, io: ReviewIo): string {
  const last = jsonOf<{ head?: string }>(io.read(flowPath(io.root, c, lastReviewed(r.ticket))), {}, lastReviewed(r.ticket)).head;
  if (last !== undefined && io.git(io.root, ['merge-base', '--is-ancestor', last, r.head]).status === 0) return last;
  return gitOut(['merge-base', `${c.remote}/${c.integrationBranch}`, r.head], io).trim();
}

/** The brief the reviewer gets on stdin. */
export function reviewBrief(r: Round, base: string): string {
  return [
    `Review ${r.branch} at the exact commit ${r.head}, built by ${r.builder}, against its ticket: standards and spec.`,
    `Inspect git diff ${base} ${r.head} and git show ${r.head}:<path>, not the working tree.`,
    `Return only JSON matching this schema: ${JSON.stringify(REVIEW_SCHEMA)}`,
    'Ticket:',
    r.text,
  ].join('\n');
}

function reviewed(r: Round, c: ReviewConfig, io: ReviewIo): { validation: ReviewValidation; exitCode: number; timedOut: boolean } {
  const base = baseOf(r, c, io);
  const dir = `review-${r.ticket}-${r.head}`;
  const prompt = flowPath(io.root, c, `${dir}/prompt.md`);
  const out = flowPath(io.root, c, `${dir}/review.json`);
  const brief = reviewBrief(r, base);
  io.write(prompt, brief);
  const values = { prompt, worktree: io.root, branch: r.branch, head: r.head, base, ticket: r.ticket, out };
  const run = runModel(r.reviewer, 'review', values, io.root, brief, io);
  const validation = validateReview({ exitCode: run.exitCode, output: io.read(out) ?? run.output });
  io.write(flowPath(io.root, c, `${dir}/validated.json`), jsonText(validation));
  if (validation.ok) io.write(flowPath(io.root, c, lastReviewed(r.ticket)), jsonText({ head: r.head }));
  return { validation, exitCode: run.exitCode, timedOut: run.timedOut };
}

/** Runs the other family's review of a ticket's round; 0 for a valid review, 1 otherwise, with why. */
export function flowReview(argv: string[], c: ReviewConfig, io: ReviewIo): number {
  const start = io.clock();
  try {
    const r = roundOf(argv, c, io);
    const { validation, exitCode, timedOut } = reviewed(r, c, io);
    const base = { at: io.now(), run: 'flow', project: '', ticket: r.ticket, role: 'flow-review' };
    const record = { ...base, kind: 'build-review' as const, builder: r.builder, reviewer: r.reviewer.name, round: roundIn(r.text), head: r.head, ms: io.clock() - start, exitCode, timedOut };
    appendRecords(io.root, c, [{ ...record, findings: validation.findings, errors: validation.errors }], io);
    io.out(`${r.reviewer.name} reviewed ${r.branch} @ ${r.head.slice(0, 7)} (built by ${r.builder}): ${JSON.stringify(validation)}\n`);
    return validation.ok ? 0 : 1;
  } catch (e) {
    io.out(`${(e as Error).message}\n`);
    return 1;
  }
}
