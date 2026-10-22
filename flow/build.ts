// flow build (ticket 84, from scripts/flow/codex-build.ts; 11-optimisations items 6 and 7): one
// build or fix round by a configured family, any of them. The round takes a place under the build
// cap first (in-flight.ts) and gives it back at the end. In a worktree of its own on the ticket
// branch (or the integration branch for a first round), with the base merged in, the family's build
// command gets the brief on stdin and {prompt}, {worktree}, {branch}, {base} and {ticket}. The
// model only edits files: the flow owns git. Then config/flow.json's checks run in the worktree, the
// full set the brief asked the model to run before handover; any failure stops the round, nothing
// pushed. The ticket's Result gets `Builder: <family>` and `Round: <n>`, and the round is committed path
// by path (every changed and new file git lists) and pushed to the ticket branch. A build-review record keeps its family, round, wall time and
// exit code. With git, the model, the shell, the files and the clock injected.

import { parseArgs } from 'node:util';
import { builds } from './builds.ts';
import type { FlowConfig } from './config.ts';
import { endBuild, reserveBuild, type InFlightIo } from './in-flight.ts';
import { familyNamed, runModel, type ModelIo } from './model-run.ts';
import { appendRecords } from './records.ts';
import { builderIn, flowPath, hasResult, nameOfTicket, repoPath, ticketFile, worktreePath } from './state.ts';

export interface BuildIo extends InFlightIo, ModelIo {
  append(path: string, text: string): void;
  /** The file names in the ticket folder, a repo path. */
  ticketFiles(folder: string): string[];
  /** A unique part of the worktree's name. */
  id(): string;
  /** Milliseconds, from any fixed point. */
  clock(): number;
}

export interface BuildRequest {
  ticket: string;
  name: string;
  family: string;
  round: string;
  prompt?: string;
}

const USAGE = 'usage: flow build <ticket> --family <name> [--round <n>] [--prompt <file>]';

function request(argv: string[], c: FlowConfig, io: BuildIo): BuildRequest {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { family: { type: 'string' }, round: { type: 'string' }, prompt: { type: 'string' } } });
  if (positionals.length !== 1 || values.family === undefined) throw new Error(USAGE);
  const ticket = positionals[0]!;
  const name = nameOfTicket(io.ticketFiles(c.ticketFolder), ticket);
  if (name === undefined) throw new Error(`no ticket ${ticket} in ${c.ticketFolder}`);
  return { ticket, name, family: familyNamed(c, values.family).name, round: values.round ?? '1', prompt: values.prompt };
}

/** The brief the builder gets on stdin: the rules of the round, the checks to run before handover, the ticket and any extra prompt. */
export function buildBrief(r: BuildRequest, c: FlowConfig, io: Pick<BuildIo, 'root' | 'read'>): string {
  const ticket = io.read(repoPath(io.root, ticketFile(r.name, c)));
  if (ticket === undefined) throw new Error(`${ticketFile(r.name, c)} cannot be read`);
  const extra = r.prompt === undefined ? '' : io.read(r.prompt);
  if (extra === undefined) throw new Error(`the prompt file ${r.prompt} cannot be read`);
  return [
    `Build ticket ${r.ticket}, round ${r.round}, as the ${r.family} family.`,
    'Only edit files. Never git add, commit, merge, checkout or push: the flow owns git.',
    'Test-first, one Pass-when line at a time.',
    `Before handing over, run every check and fix what fails: ${c.checks.join('; ')}.`,
    'Then state the highest CRAP score and the mutants killed of total for the head in the Result; where the mutation tool cannot run, say so and give CRAP from a coverage file.',
    ticket,
    extra,
  ].join('\n');
}

function gitOut(io: BuildIo, cwd: string, args: string[]): string {
  const r = io.git(cwd, args);
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** The ticket's Result with this round's family and number; a heading when it has none, a Builder line unless the last one names the family. */
export function withRound(text: string, family: string, round: string): string {
  const heading = hasResult(text) ? '' : '\n## Result\n';
  const builder = builderIn(text) === family ? '' : `\nBuilder: ${family}\n`;
  return `${text}${heading}${builder}\nRound: ${round}\n`;
}

function publish(r: BuildRequest, wt: string, c: FlowConfig, io: BuildIo): void {
  const path = repoPath(wt, ticketFile(r.name, c));
  io.write(path, withRound(io.read(path) ?? '', r.family, r.round));
  const paths = gitOut(io, wt, ['-c', 'status.renames=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter((entry) => entry !== '').map((entry) => entry.slice(3));
  gitOut(io, wt, ['add', '--', ...paths]);
  gitOut(io, wt, ['commit', '-q', '-m', `Build ticket ${r.ticket}, round ${r.round} (${r.family})`]);
  gitOut(io, wt, ['push', c.remote, `HEAD:refs/heads/${c.branchPrefix}${r.name}`]);
}

function checked(command: string, wt: string, timeoutMs: number, io: BuildIo): void {
  const r = io.shell(command, wt, '', timeoutMs, {});
  io.out(`${r.stdout}${r.stderr}`);
  if (r.status !== 0) throw new Error(`the check ${command} failed in ${wt}`);
}

function built(r: BuildRequest, wt: string, brief: string, c: FlowConfig, io: BuildIo): void {
  const family = familyNamed(c, r.family);
  const branch = `${c.remote}/${c.branchPrefix}${r.name}`;
  const base = `${c.remote}/${c.integrationBranch}`;
  gitOut(io, io.root, ['fetch', c.remote]);
  const exists = io.git(io.root, ['rev-parse', '--verify', `${branch}^{commit}`]).status === 0;
  gitOut(io, io.root, ['worktree', 'add', '--detach', wt, exists ? branch : base]);
  gitOut(io, wt, ['merge', '--no-ff', '-m', `Merge ${c.integrationBranch} for ticket ${r.ticket}`, base]);
  const run = runModel(family, 'build', { prompt: flowPath(io.root, c, `build-${r.ticket}-${r.round}.md`), worktree: wt, branch: `${c.branchPrefix}${r.name}`, base, ticket: r.ticket }, wt, brief, io);
  io.out(run.output);
  if (run.exitCode !== 0) throw new Error(`the ${r.family} build ${run.timedOut ? 'timed out' : `exited ${run.exitCode}`}`);
  for (const command of c.checks) checked(command, wt, family.timeoutMs, io);
  publish(r, wt, c, io);
}

function reserved(r: BuildRequest, brief: string, c: FlowConfig, io: BuildIo): number {
  const branch = `${c.branchPrefix}${r.name}`;
  const wt = worktreePath(io.root, c, `build-${r.ticket}-${io.id()}`);
  const started = io.clock();
  reserveBuild(branch, r.family, builds(c, io), c, io);
  let exitCode = 1;
  try {
    io.write(flowPath(io.root, c, `build-${r.ticket}-${r.round}.md`), brief);
    built(r, wt, brief, c, io);
    exitCode = 0;
  } finally {
    endBuild(branch, c, io);
    const base = { at: io.now(), run: 'flow', project: '', ticket: r.ticket, role: 'flow-build' };
    appendRecords(io.root, c, [{ ...base, kind: 'build-review', builder: r.family, round: r.round, ms: io.clock() - started, exitCode }], io);
    io.out(`The build worktree stays at ${wt}.\n`);
  }
  return exitCode;
}

/** Builds one round of a ticket with a configured family; 0 pushed, 1 refused or failed, with why. */
export function flowBuild(argv: string[], c: FlowConfig, io: BuildIo): number {
  try {
    const r = request(argv, c, io);
    return reserved(r, buildBrief(r, c, io), c, io);
  } catch (e) {
    io.out(`${(e as Error).message}\n`);
    return 1;
  }
}
