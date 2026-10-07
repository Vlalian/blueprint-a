// One cache of check results, keyed by the tree they ran on (ticket 37). The pilot's builds linted,
// typechecked and tested the same tree up to ten times: the Stop gate, then the controller again
// on the tree the gate had just judged, then the next role's gate on a tree that role had not
// changed. A passing check is stored under state/check-cache/<project>/<tree>.json, the tree being
// `git write-tree` of the worktree with its untracked files (tree.ts), and the entry keyed by the
// check's name, its command and the hash of the env file it ran with: a changed file, command or
// env file runs it again. A failing check is never stored, so a flaky or infrastructure failure is
// never pinned to a tree. A check the project marks `alwaysRun`, and the tamper check (it reads the
// git hooks and state/, which no tree holds), always run. Pure; the git and file I/O is injected.

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { runChecks, type CheckResult, type GateResult, type Runner } from './check.ts';

/** Checks that never come from the cache, whatever the project says. */
export const ALWAYS_RUN = ['tamper'];

export interface CacheIo {
  /** The file's text, or undefined when it does not exist. */
  read(path: string): string | undefined;
  /** Writes the file, creating its folder. */
  write(path: string, text: string): void;
  /** The worktree's tree hash, untracked files included; undefined when git cannot name one. */
  tree(cwd: string): string | undefined;
  /** A monotonic clock in milliseconds, to time each check. */
  ms(): number;
}

export interface CacheWhere {
  /** state/check-cache/<project>; nothing is cached when undefined. */
  dir: string | undefined;
  /** The env file's text the checks run with; undefined when there is none. */
  envText: string | undefined;
  /** The project's `alwaysRun` checks; none when absent. */
  alwaysRun?: string[];
}

/** Where a check's result came from (an observation's `source`), its ms here, and for a cached one the ms its run took. */
export type SourcedResult = CheckResult & { source: 'ran' | 'cached'; ms: number; savedMs?: number };
export interface SourcedGate extends GateResult {
  results: SourcedResult[];
  tree?: string;
}

type Entry = { tail: string; ms: number };
type Store = Record<string, Entry>;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** One check's key within a tree: its name, its command and the env file it ran with. */
export const entryKey = (name: string, command: string, envText: string) => sha(JSON.stringify([name, command, sha(envText)]));

function readStore(path: string | undefined, io: CacheIo): Store {
  try {
    return Object(JSON.parse(io.read(path as string) as string)) as Store;
  } catch {
    return {};
  }
}

const treeOf = (where: CacheWhere, cwd: string, io: CacheIo) => (where.dir === undefined ? undefined : io.tree(cwd));
const storePath = (where: CacheWhere, tree: string | undefined) => (tree === undefined ? undefined : posix.join(where.dir as string, `${tree}.json`));

/** One check, timed. */
function ranCheck(name: string, command: string, run: Runner, cwd: string, io: CacheIo): SourcedResult {
  const start = io.ms();
  const r = runChecks({ [name]: command }, run, cwd).results[0] as CheckResult;
  return { ...r, source: 'ran', ms: io.ms() - start };
}

const cachedCheck = (name: string, command: string, hit: Entry): SourcedResult => ({ name, command, exitCode: 0, tail: hit.tail, source: 'cached', ms: 0, savedMs: hit.ms });

/** What every check of one gate run shares: the folder it runs in, the stored entries and the fresh ones. */
interface Run {
  run: Runner;
  cwd: string;
  io: CacheIo;
  /** undefined: nothing is cached on this run. */
  path: string | undefined;
  envText: string;
  always: Array<string | undefined>;
  stored: Store;
  fresh: Store;
}

const keyOf = (name: string, command: string, r: Run) => (r.path === undefined || r.always.includes(name) ? undefined : entryKey(name, command, r.envText));

/** One check from the cache when it has it, else run, and stored when it passed. */
function oneCheck(name: string, command: string, r: Run): SourcedResult {
  const key = keyOf(name, command, r);
  const hit = r.stored[key as string];
  if (hit !== undefined) return cachedCheck(name, command, hit);
  const result = ranCheck(name, command, r.run, r.cwd, r.io);
  if (key !== undefined && result.exitCode === 0) r.fresh[key] = { tail: result.tail, ms: result.ms };
  return result;
}

/** The checks, each from the cache when this tree, command and env file passed it before; see the top of this file. */
export function runCachedChecks(commands: Record<string, string>, run: Runner, cwd: string, where: CacheWhere, io: CacheIo): SourcedGate {
  const entries = Object.entries(commands);
  if (entries.length === 0) return { ...runChecks(commands, run, cwd), results: [] };
  const tree = treeOf(where, cwd, io);
  const path = storePath(where, tree);
  const r: Run = { run, cwd, io, path, envText: where.envText ?? '', always: [ALWAYS_RUN, where.alwaysRun].flat(), stored: readStore(path, io), fresh: {} };
  const results = entries.map(([name, command]) => oneCheck(name, command, r));
  if (Object.keys(r.fresh).length > 0) io.write(path as string, JSON.stringify({ ...r.stored, ...r.fresh }));
  return { gate: 'four-checks', pass: results.every((x) => x.exitCode === 0), results, tree };
}
