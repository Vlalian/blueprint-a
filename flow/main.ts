// `flow <tool> [args]` (ticket 84): one command for every flow tool, with config/flow.json read
// once from the repo it runs in. status, done, in-flight, gate-queue, build, review, merge and
// apply-lessons are this folder's; pr, watch-pr and ledger are the draft PR, the CI watch on one exact commit and the
// SHA ledger, each on the host config/flow.json names (adapters/host: GitHub or Azure DevOps) and
// printing JSON. An unknown tool prints the usage and exits 2; a broken config/flow.json exits 2
// naming the field. With every process and file injected.

import { hostAdapterOrFailure, type HostDeps } from '../adapters/host/config.ts';
import { done } from './builds.ts';
import { flowBuild, type BuildIo } from './build.ts';
import { FLOW_CONFIG, parseFlowConfig, type FlowConfig } from './config.ts';
import { gateQueue, type GateQueueIo } from './gate-queue.ts';
import { flowInFlight, sharedPath } from './in-flight.ts';
import { runLedger } from './ledger-core.ts';
import { flowApplyLessons } from './lessons.ts';
import { flowMerge, type MergeIo } from './merge.ts';
import { runPr } from './pr-core.ts';
import { flowReview, type ReviewIo } from './review.ts';
import { FLOW_FILES, repoPath } from './state.ts';
import { status } from './status.ts';
import { runWatch } from './watch-pr-core.ts';

export type FlowIo = BuildIo &
  ReviewIo &
  MergeIo &
  Omit<GateQueueIo, 'acquire' | 'release'> & {
    /** What the host adapters run on in `cwd`: gh, the HTTP client and the environment. */
    hostDeps(cwd: string): HostDeps;
    /** git in `cwd` that throws on a failing command. */
    gitIn(cwd: string): (args: string[], input?: string) => string;
    /** Milliseconds since the epoch. */
    epochMs(): number;
    sleep(ms: number): void;
    /** Progress, one line at a time. */
    log(line: string): void;
  };

type Tool = (argv: string[], c: FlowConfig, io: FlowIo) => number;

const json = (io: FlowIo, r: { json: unknown; exitCode: number }) => (io.out(`${JSON.stringify(r.json, null, 2)}\n`), r.exitCode);

/** The PR's base is the integration branch and its host config/flow.json's, unless the arguments say otherwise; pr-core reads the host from a named project, and the flow's one project is named after its integration branch. */
const pr: Tool = (argv, c, io) =>
  json(io, runPr(['--project', c.integrationBranch, '--base', c.integrationBranch, '--remote', c.remote, ...argv], (cwd, host) => ({ git: io.gitIn(cwd), host: hostAdapterOrFailure(host, io.hostDeps(cwd)) }), () => ({ pr: c.host })));

/** The CI watch on config/flow.json's host. */
const watchPr: Tool = (argv, c, io) => json(io, runWatch(argv, (cwd) => ({ host: hostAdapterOrFailure(c.host, io.hostDeps(cwd)), now: io.epochMs, sleep: io.sleep, log: io.log })));

/** The ledger's rows carry the time to the second. */
const ledger: Tool = (argv, _, io) => json(io, runLedger(argv, (cwd) => ({ git: io.gitIn(cwd), read: io.read, append: io.append, now: () => `${io.now().slice(0, 19)}Z` })));

/** One gate runner at a time across every worktree of the repo: the gate lock is in git's common directory. */
const gateQueueTool: Tool = (argv, c, io) => {
  const lock = io.lock(sharedPath(c, io, FLOW_FILES.gateLock));
  return gateQueue(argv, c, { ...io, acquire: () => lock.acquire(), release: (token) => lock.release(token) });
};

export const TOOLS: Record<string, Tool> = {
  status: (_, c, io) => status(c, io),
  done: (_, c, io) => done(c, io),
  'in-flight': flowInFlight,
  'gate-queue': gateQueueTool,
  build: flowBuild,
  review: flowReview,
  merge: flowMerge,
  'apply-lessons': flowApplyLessons,
  pr,
  'watch-pr': watchPr,
  ledger,
};

export const USAGE = `usage: flow <${Object.keys(TOOLS).join('|')}> [args]\n`;

/** Runs one tool with the repo's config/flow.json; 2 for an unknown tool or a broken config. */
export function runFlow([name, ...argv]: string[], io: FlowIo): number {
  const tool = Object.hasOwn(TOOLS, String(name)) ? TOOLS[name!] : undefined;
  if (tool === undefined) return (io.out(USAGE), 2);
  let c: FlowConfig;
  try {
    c = parseFlowConfig(io.read(repoPath(io.root, FLOW_CONFIG)));
  } catch (e) {
    return (io.out(`${(e as Error).message}\n`), 2);
  }
  return tool(argv, c, io);
}
