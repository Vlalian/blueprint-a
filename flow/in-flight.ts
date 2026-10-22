// The builds in flight (ticket 84, from scripts/flow/in-flight.ts; 11-optimisations item 7): at
// most the configured build cap at a time, every model family counted together. `flow in-flight
// start <branch> <family>` records a build when it starts (a fix round too), `end <branch>` when it
// is done, in the state folder under git's common directory (shared by every worktree), under a
// lock. A ticket branch on the remote without its Result is a build in flight too, recorded or
// not, by an unrecorded family. `flow status` warns above the cap; the merge's base-into skips a
// branch a build is writing to. With git, the files, the lock and the clock injected.

import { isAbsolute, join } from 'node:path';
import type { Acquired } from '../runner/lock.ts';
import type { Build, Git } from './builds.ts';
import type { FlowConfig } from './config.ts';
import { familyNamed } from './model-run.ts';
import { flowPath, FLOW_FILES, jsonOf, jsonText } from './state.ts';

export interface InFlight {
  branch: string;
  family: string;
  at: string;
}

export type Flight = Pick<InFlight, 'branch' | 'family'>;

/** The family a running build is counted under when no start recorded it. */
export const UNRECORDED = 'unrecorded';

export interface InFlightIo {
  root: string;
  git: Git;
  read(path: string): string | undefined;
  write(path: string, text: string): void;
  lock(path: string): { acquire(): Acquired; release(token: string): void };
  now(): string;
  out(text: string): void;
}

type Where = Pick<FlowConfig, 'stateDir'>;

/** A state file every worktree of the repo shares: in the state folder under git's common directory (printed relative to the worktree by the main one). */
export function sharedPath(c: Where, io: Pick<InFlightIo, 'root' | 'git'>, file: string): string {
  const common = io.git(io.root, ['rev-parse', '--git-common-dir']);
  if (common.status !== 0) throw new Error(`git cannot name its common directory, where the flow keeps ${file}`);
  const dir = common.stdout.trim();
  return flowPath(isAbsolute(dir) ? dir : join(io.root, dir), c, file);
}

/** The registrations' file, shared by every worktree. */
const pathOf = (c: Where, io: Pick<InFlightIo, 'root' | 'git'>) => sharedPath(c, io, FLOW_FILES.inFlight);

export const readInFlight = (c: Where, io: Pick<InFlightIo, 'root' | 'git' | 'read'>) => jsonOf<InFlight[]>(io.read(pathOf(c, io)), [], FLOW_FILES.inFlight);

/** `fn`'s result, run under the registrations' lock. */
function underLock<T>(c: Where, io: InFlightIo, fn: () => T): T {
  const lock = io.lock(`${pathOf(c, io)}.lock`);
  const held = lock.acquire();
  if (!held.ok) throw new Error('the builds in flight are being recorded by another run; try again');
  try {
    return fn();
  } finally {
    lock.release(held.token);
  }
}

/** The recorded builds, then each running build that is not recorded. */
export function buildsInFlight(builds: Build[], recorded: InFlight[]): Flight[] {
  const known = new Set(recorded.map((f) => f.branch));
  const running = builds.filter((b) => b.state === 'running' && !known.has(b.branch));
  return [...recorded.map(({ branch, family }) => ({ branch, family })), ...running.map((b): Flight => ({ branch: b.branch, family: UNRECORDED }))];
}

/** How many builds each family has in flight, in the order first seen: `local 2, cloud 1`. */
export function byFamily(flights: Flight[]): string {
  const counts = new Map<string, number>();
  for (const f of flights) counts.set(f.family, (counts.get(f.family) ?? 0) + 1);
  return [...counts].map(([family, n]) => `${family} ${n}`).join(', ');
}

/** Why the builds in flight break the cap, or nothing. */
export function capWarning(flights: Flight[], c: Pick<FlowConfig, 'buildCap'>): string | undefined {
  if (flights.length <= c.buildCap) return undefined;
  return `${flights.length} builds in flight (${byFamily(flights)}): more than the cap of ${c.buildCap}, every family counted together`;
}

type Config = Pick<FlowConfig, 'stateDir' | 'families' | 'buildCap'>;

function start(branch: string, family: string, c: Config, io: InFlightIo): string {
  familyNamed(c, family);
  const others = readInFlight(c, io).filter((f) => f.branch !== branch);
  io.write(pathOf(c, io), jsonText([...others, { branch, family, at: io.now() }]));
  return `Recorded a ${family} build in flight on ${branch}.`;
}

function end(branch: string, c: Where, io: InFlightIo): string {
  const recorded = readInFlight(c, io);
  const others = recorded.filter((f) => f.branch !== branch);
  if (others.length === recorded.length) return `${branch} was not recorded in flight.`;
  io.write(pathOf(c, io), jsonText(others));
  return `${branch} is no longer in flight.`;
}

/** Reserves one of the cap's places for a build of `family` on `branch`, counting unrecorded running builds too; throws when there is none. */
export function reserveBuild(branch: string, family: string, builds: Build[], c: Config, io: InFlightIo): void {
  underLock(c, io, () => {
    const flights = buildsInFlight(builds, readInFlight(c, io));
    if (flights.some((f) => f.branch === branch)) throw new Error(`${branch} is in flight already`);
    if (flights.length >= c.buildCap) throw new Error(`the build cap of ${c.buildCap} is reached (${byFamily(flights)})`);
    start(branch, family, c, io);
  });
}

/** Ends the record of a build on `branch`, under the lock. */
export const endBuild = (branch: string, c: Where, io: InFlightIo) => underLock(c, io, () => end(branch, c, io));

const USAGE = 'usage: flow in-flight start <branch> <family> | end <branch>\n';

function commandOf([verb, branch, ...rest]: string[], c: Config, io: InFlightIo): (() => string) | undefined {
  if (branch === undefined) return undefined;
  if (verb === 'start' && rest.length === 1) return () => start(branch, rest[0]!, c, io);
  return verb === 'end' && rest.length === 0 ? () => end(branch, c, io) : undefined;
}

/** 0 recorded; 1 for a family that is not configured; 2 for the usage. */
export function flowInFlight(argv: string[], c: Config, io: InFlightIo): number {
  const run = commandOf(argv, c, io);
  if (run === undefined) return (io.out(USAGE), 2);
  try {
    io.out(`${underLock(c, io, run)}\n`);
    return 0;
  } catch (e) {
    io.out(`${(e as Error).message}\n`);
    return 1;
  }
}
