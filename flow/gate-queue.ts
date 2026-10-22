// flow gate-queue (ticket 84, from scripts/flow/gate-queue.ts): one merge gate at a time.
// `add <branch>` queues a ticket branch, `list` shows the queue and the results, `run` gates the
// queue in order. A runner holds the gate lock (scripts/lock.ts): a second runner exits, a dead
// runner's lock is taken over. Each gate runs in the flow's gate worktree, never one a person works
// in: the integration branch and the ticket branch merged without a commit, then each of
// config/flow.json's gate commands through a shell, {base} the integration commit and {branch} the
// ticket branch on the remote, passed as variables (model-run's render). The first command that fails names the stage; a conflict is its own
// status, and the queue goes on. Nothing is committed or pushed. With git, the shell and the files
// injected.

import type { Acquired, LockRecord } from '../runner/lock.ts';
import type { Git } from './builds.ts';
import type { FlowConfig } from './config.ts';
import { addGate, listLines, readGates, resultLine, type GateEntry, type GateQueue, type GateResult, type GateStatus } from './gate-queue-state.ts';
import { render } from './model-run.ts';
import { flowPath, FLOW_FILES, jsonText, worktreePath } from './state.ts';

export interface GateQueueIo {
  root: string;
  read(path: string): string | undefined;
  write(path: string, text: string): void;
  append(path: string, text: string): void;
  exists(path: string): boolean;
  acquire(): Acquired;
  release(token: string): void;
  git: Git;
  /** The platform the shell runs on (render). */
  platform: NodeJS.Platform;
  /** A shell command in `cwd` with `env` added to the environment and its output appended to `log`; its exit status. */
  logged(command: string, cwd: string, log: string, env: Record<string, string>): number | null;
  now(): string;
  out(text: string): void;
}

export type GateConfig = Pick<FlowConfig, 'stateDir' | 'worktreeDir' | 'remote' | 'integrationBranch' | 'branchPrefix' | 'gate'>;

const queuePath = (c: GateConfig, io: GateQueueIo) => flowPath(io.root, c, FLOW_FILES.gateQueue);
const load = (c: GateConfig, io: GateQueueIo) => readGates(io.read(queuePath(c, io)));
const save = (c: GateConfig, io: GateQueueIo, q: GateQueue) => io.write(queuePath(c, io), jsonText(q));

/** One line on who holds the gate lock. */
export const heldLine = (by: LockRecord | null) =>
  by === null ? 'Another gate runner holds the gate lock (its lock file could not be read); exiting.' : `Another gate runner holds the gate lock (pid ${by.pid} on ${by.host}, since ${by.startedAt}); exiting.`;

type Gate = { entry: GateEntry; base: string; log: string; wt: string };

const gitOk = (io: GateQueueIo, cwd: string, args: string[], log: string) => {
  const r = io.git(cwd, args);
  io.append(log, `$ git ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.status === 0;
};

const revParse = (io: GateQueueIo, ref: string) => {
  const r = io.git(io.root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return r.status === 0 ? r.stdout.trim() : undefined;
};

/** The gate worktree on the integration commit with nothing left of the last gate; made when missing. */
function prepared(g: Gate, io: GateQueueIo): boolean {
  if (!io.exists(g.wt)) return gitOk(io, io.root, ['worktree', 'add', '--detach', g.wt, g.base], g.log);
  gitOk(io, g.wt, ['merge', '--abort'], g.log);
  return [['reset', '--hard', '-q'], ['clean', '-fdq'], ['checkout', '--detach', '-q', g.base]].every((args) => gitOk(io, g.wt, args, g.log));
}

type Outcome = { status: GateStatus; stage?: string };

/** The first gate command that fails, by its place in config/flow.json's gate list, or green. */
function commandsOutcome(g: Gate, c: GateConfig, io: GateQueueIo): Outcome {
  const values = { base: g.base, branch: `${c.remote}/${g.entry.branch}` };
  const failed = c.gate.findIndex((command, i) => {
    io.append(g.log, `\n=== gate ${i + 1}: ${command}\n`);
    const rendered = render(command, values, io.platform);
    return io.logged(rendered.command, g.wt, g.log, rendered.env) !== 0;
  });
  return failed === -1 ? { status: 'green' } : { status: 'red', stage: `gate ${failed + 1}` };
}

function outcome(g: Gate, c: GateConfig, io: GateQueueIo): Outcome {
  if (!prepared(g, io)) return { status: 'red', stage: 'worktree' };
  if (!gitOk(io, g.wt, ['merge', '--no-commit', '--no-ff', `${c.remote}/${g.entry.branch}`], g.log)) return { status: 'conflict', stage: 'merge' };
  return commandsOutcome(g, c, io);
}

const logName = (entry: GateEntry, at: string) => `${FLOW_FILES.logs}/gate-${entry.ticket}-${at.replace(/[:.]/g, '-')}.log`;

/** Gates one ticket branch; its result. */
export function gateOne(entry: GateEntry, c: GateConfig, io: GateQueueIo): GateResult {
  const at = io.now();
  const log = flowPath(io.root, c, logName(entry, at));
  const fetched = gitOk(io, io.root, ['fetch', c.remote], log);
  const base = revParse(io, `${c.remote}/${c.integrationBranch}`);
  const head = revParse(io, `${c.remote}/${entry.branch}`);
  const result = { ticket: entry.ticket, branch: entry.branch, head: head ?? '', base: base ?? '', log, at };
  if (!fetched || base === undefined || head === undefined) return { ...result, status: 'red', stage: 'fetch' };
  return { ...result, ...outcome({ entry, base, log, wt: worktreePath(io.root, c, 'gate-queue') }, c, io) };
}

/** The first queued branch, taken off the queue. */
function takeNext(c: GateConfig, io: GateQueueIo): GateEntry | undefined {
  const q = load(c, io);
  const [next, ...rest] = q.queue;
  if (next !== undefined) save(c, io, { ...q, queue: rest });
  return next;
}

function gateNext(entry: GateEntry, c: GateConfig, io: GateQueueIo): void {
  io.out(`gating ${entry.branch}\n`);
  const result = gateOne(entry, c, io);
  const after = load(c, io);
  save(c, io, { ...after, results: [...after.results, result] });
  io.out(`${resultLine(result)}\n`);
}

/** Gates the queue in order, holding the gate lock; 1 when another runner holds it. */
export function runGates(c: GateConfig, io: GateQueueIo): number {
  const lock = io.acquire();
  if (!lock.ok) return (io.out(`${heldLine(lock.heldBy)}\n`), 1);
  if (lock.takenOverFrom !== undefined) io.out(`Took over the gate lock of pid ${lock.takenOverFrom.pid}, which died.\n`);
  try {
    for (let next = takeNext(c, io); next !== undefined; next = takeNext(c, io)) gateNext(next, c, io);
  } finally {
    io.release(lock.token);
  }
  return 0;
}

const USAGE = 'usage: flow gate-queue add <ticket branch> | list | run\n';

/** list or run, the commands without a branch; undefined for any other. */
function bare(command: string | undefined, c: GateConfig, io: GateQueueIo): number | undefined {
  if (command === 'list') return (io.out(`${listLines(load(c, io)).join('\n')}\n`), 0);
  return command === 'run' ? runGates(c, io) : undefined;
}

/** The branch without the remote's name in front. */
const local = (branch: string, c: GateConfig) => (branch.startsWith(`${c.remote}/`) ? branch.slice(c.remote.length + 1) : branch);

/** add, list or run; 2 with the usage for anything else. */
export function gateQueue(argv: string[], c: GateConfig, io: GateQueueIo): number {
  const [command, branch, ...rest] = argv;
  if (rest.length > 0) return (io.out(USAGE), 2);
  if (branch === undefined) return bare(command, c, io) ?? (io.out(USAGE), 2);
  if (command !== 'add') return (io.out(USAGE), 2);
  const added = addGate(load(c, io), local(branch, c), io.now(), c);
  save(c, io, added.queue);
  io.out(`${added.note}\n`);
  return 0;
}
