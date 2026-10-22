// The runner's checks with the check-tree cache (ticket 83; 11-optimisations.md item 4). The
// project's checks are config/runner.json's `checks`, each a shell command; this runs them in the
// repo root, each from the cache when it already passed on this tree with the same command and env
// file (gates/four-checks/cache.ts: the key is the tree hash, the check's name, its command and
// the env file's hash), so a pre-commit hook or a CI job on an unchanged tree reuses its result.
// A check in `alwaysRun` never comes from the cache; a failing check is never stored. The cache is
// <state folder>/check-cache/<project>: one per project, never shared. Each check is logged as a
// gate observation with its source (ran or cached), its ms and, for a cached one, the ms it saved.
// --only <name> runs only the named checks (repeatable); a name the config does not have is an error.
// Pure: the files, git's tree, the commands and the clock are injected.

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { baseOf, observationLine, OBSERVATIONS, type Observation } from './observations.ts';
import { runCachedChecks, type CacheIo, type SourcedResult } from '../gates/four-checks/cache.ts';
import { parseEnvFile, withEnvFile, type EnvRunner } from '../gates/four-checks/env-file.ts';
import { parseRunnerConfig, RUNNER_CONFIG } from './runner-config.ts';

type Env = Record<string, string | undefined>;

export interface RunnerChecksIo extends CacheIo {
  /** The repo root: the checks run there. */
  root: string;
  /** The project's name for the cache folder. */
  project: string;
  /** Runs one check through the shell with the env file's variables added. */
  run: EnvRunner;
  append(path: string, text: string): void;
  now(): string;
}

const GATE = 'runner-checks';

/** The gate result: each check with its source, and the tree they were judged on. */
export type RunnerChecksResult = { gate: string; pass: boolean; error?: string; results: SourcedResult[]; tree?: string };

/** The checks to run: every configured one, or the --only ones, each of which must be configured. */
function chosen(all: Record<string, string>, only: string[] | undefined): Record<string, string> {
  if (only === undefined) return all;
  const unknown = only.filter((n) => !(n in all));
  if (unknown.length > 0) throw new Error(`${RUNNER_CONFIG} has no check named ${unknown.join(', ')}`);
  return Object.fromEntries(only.map((n) => [n, all[n]]));
}

const observation = (base: ReturnType<typeof baseOf>, tree: string, r: SourcedResult): Observation => ({
  ...base,
  kind: 'gate',
  gate: r.name,
  sha: tree,
  verdict: r.exitCode === 0 ? 'pass' : 'fail',
  reasons: [],
  ms: Math.round(r.ms),
  source: r.source,
  ...(r.savedMs === undefined ? {} : { savedMs: Math.round(r.savedMs) }),
});

/** The configured checks, each from the cache when this tree, command and env file passed it before. */
export function runnerChecks(argv: string[], env: Env, io: RunnerChecksIo): RunnerChecksResult {
  const { values } = parseArgs({ args: argv, options: { only: { type: 'string', multiple: true } } });
  const config = parseRunnerConfig(io.read(join(io.root, RUNNER_CONFIG)));
  const commands = chosen(config.checks, values.only);
  const envText = config.envFile === '' ? undefined : io.read(join(io.root, config.envFile));
  const state = env.WORKFLOW_STATE_DIR ?? join(io.root, config.stateDir);
  const where = { dir: join(state, 'check-cache', io.project), envText, alwaysRun: config.alwaysRun };
  const result = runCachedChecks(commands, withEnvFile(parseEnvFile(envText), io.run), io.root, where, io);
  const base = baseOf(env, io.now());
  io.append(join(state, OBSERVATIONS), result.results.map((r) => observationLine(observation(base, result.tree ?? '', r))).join(''));
  return { ...result, gate: GATE };
}
