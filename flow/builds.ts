// The builds the flow knows (ticket 84, from scripts/flow/done.ts): every ticket branch on the
// remote with its state. A branch is the configured prefix and its ticket file's name; it is
// running until its ticket file there has a `## Result` section (the done signal), done after
// that, queued or gated once the gate queue has it, and merged once the integration branch holds
// it. `flow done` lists the done ones, each with the command that queues it. With git and the gate
// queue file injected.

import type { ProcessResult } from '../adapters/host/process-result.ts';
import type { FlowConfig } from './config.ts';
import { latestResult, readGates, type GateQueue } from './gate-queue-state.ts';
import { flowPath, FLOW_FILES, hasResult, ticketFile, ticketNameOf, ticketOf } from './state.ts';

export type Git = (cwd: string, args: string[]) => ProcessResult;

export interface BuildsIo {
  root: string;
  /** git in `cwd`; never throws. */
  git: Git;
  read(path: string): string | undefined;
  out(text: string): void;
}

/** running: no Result yet; done: Result, not yet queued; queued and gated: in the gate queue; merged: in the integration branch. */
export type BuildState = 'running' | 'done' | 'queued' | 'gated' | 'merged';

export interface Build {
  /** The ticket's number, `12` of `12-login`. */
  ticket: string;
  /** The ticket file's name, `12-login`. */
  name: string;
  branch: string;
  head: string;
  state: BuildState;
}

export type BuildsConfig = Pick<FlowConfig, 'remote' | 'branchPrefix' | 'integrationBranch' | 'ticketFolder' | 'stateDir'>;

const stdoutOf = (r: ProcessResult) => (r.status === 0 ? r.stdout : '');

/** The ticket branches on the remote, without the remote's name. */
function ticketBranches(c: BuildsConfig, io: BuildsIo): string[] {
  const listed = stdoutOf(io.git(io.root, ['for-each-ref', '--format=%(refname:short)', `refs/remotes/${c.remote}/${c.branchPrefix}`]));
  return listed
    .split(/\r?\n/)
    .map((l) => l.slice(c.remote.length + 1))
    .filter((b) => ticketNameOf(b, c) !== undefined);
}

function stateOf(b: Omit<Build, 'state'>, q: GateQueue, c: BuildsConfig, io: BuildsIo): BuildState {
  if (io.git(io.root, ['merge-base', '--is-ancestor', `${c.remote}/${b.branch}`, `${c.remote}/${c.integrationBranch}`]).status === 0) return 'merged';
  if (q.queue.some((e) => e.branch === b.branch)) return 'queued';
  if (latestResult(q, b.ticket)?.head === b.head) return 'gated';
  return hasResult(stdoutOf(io.git(io.root, ['show', `${c.remote}/${b.branch}:${ticketFile(b.name, c)}`]))) ? 'done' : 'running';
}

/** Every ticket branch on the remote with its state, after a fetch. */
export function builds(c: BuildsConfig, io: BuildsIo): Build[] {
  io.git(io.root, ['fetch', c.remote]);
  const q = readGates(io.read(flowPath(io.root, c, FLOW_FILES.gateQueue)));
  return ticketBranches(c, io).map((branch) => {
    const name = ticketNameOf(branch, c)!;
    const head = stdoutOf(io.git(io.root, ['rev-parse', `${c.remote}/${branch}`])).trim();
    const b = { ticket: ticketOf(name)!, name, branch, head };
    return { ...b, state: stateOf(b, q, c, io) };
  });
}

/** Prints the done builds, each with the command that queues it. */
export function done(c: BuildsConfig, io: BuildsIo): number {
  const ready = builds(c, io).filter((b) => b.state === 'done');
  const lines = ready.map((b) => `${b.ticket}  ${b.branch} @ ${b.head.slice(0, 7)}  (flow gate-queue add ${b.branch})`);
  io.out(`${(lines.length === 0 ? ['No finished build waits for the gate queue.'] : lines).join('\n')}\n`);
  return 0;
}
