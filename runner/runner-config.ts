// The runner's settings (ticket 83): everything the self-gate, the test selection, the checks and
// the metrics need to know about the repo they run in, read from config/runner.json. A field the
// file leaves out keeps its default (DEFAULTS, documented in docs/blueprint-a/12-runner.md); a
// field of the wrong type is an error, so a typo never runs the gate with a default the team did
// not choose. Path patterns (wholeSuite, report.ungraded) are a folder ending in '/', a file
// name, or a name with '*' standing for any characters but '/'.
// Pure: the file's text in, the settings out.

export interface RunnerConfig {
  /** The branch merges go into: the self-gate's base when --base is not given. */
  integrationBranch: string;
  /** The folders whose TypeScript the gate grades (CRAP and mutation). */
  sourceDirs: string[];
  /** The folders dependency-cruiser walks for the test selection, and the portability sweeps read. */
  graphDirs: string[];
  /** Paths every test may read: a change to one runs the whole suite. */
  wholeSuite: string[];
  /** How an integration test is named, and the vitest config that runs them. */
  integrationTests: { suffix: string; config: string };
  /** The highest CRAP score a graded function may have. */
  crapLimit: number;
  /** The JSON file whose `stryker` object holds Stryker's timeoutMS, timeoutFactor and dryRunTimeoutMinutes. */
  strykerConfig: string;
  /**
   * The CI report: its folder, the checks a merge may trust from it, the paths that may change after
   * it, the environment variable that is 'true' in the CI run that writes it, and its file name, one
   * per branch, {branch} standing for the branch.
   */
  report: { dir: string; trusted: string[]; ungraded: string[]; env: string; name: string };
  /** A module of this repo whose `mergeCheck` the merge mode also asks (scripts/merge-check.ts); '' for none. */
  mergeCheck: string;
  /** Files never mutated: process shells listed by hand (a shell can also declare itself, scripts/shells.ts). */
  exempt: string[];
  /** Folders Stryker's sandbox leaves out (onkel's --sandbox-ignore). */
  sandboxIgnore: string[];
  /** Where the runner keeps its logs, relative to the repo; WORKFLOW_STATE_DIR overrides it. */
  stateDir: string;
  /** A file in the state folder that means a run is under way: the idle full run waits for it. */
  busyLock: string;
  /** The checks `runner/checks.ts` runs, by name, each a shell command. */
  checks: Record<string, string>;
  /** Checks never taken from the cache. */
  alwaysRun: string[];
  /** The env file the checks run with (its hash is part of the cache key); '' for none. */
  envFile: string;
}

export const RUNNER_CONFIG = 'config/runner.json';

export const DEFAULTS: RunnerConfig = {
  integrationBranch: 'main',
  sourceDirs: ['src'],
  graphDirs: ['src', 'test'],
  wholeSuite: ['package.json', 'package-lock.json', 'tsconfig*.json', 'vitest*.config.ts', 'test/helpers/', 'config/'],
  integrationTests: { suffix: '.integration.test.ts', config: 'vitest.integration.config.ts' },
  crapLimit: 6,
  strykerConfig: RUNNER_CONFIG,
  report: { dir: 'gate-reports', trusted: ['mutation'], ungraded: ['docs/'], env: 'CI', name: '{branch}.gate.json' },
  mergeCheck: '',
  exempt: [],
  sandboxIgnore: [],
  stateDir: 'state',
  busyLock: 'runner.lock',
  checks: {},
  alwaysRun: [],
  envFile: '',
};

const NAMES: Record<string, string> = { list: 'a list of strings', object: 'an object', number: 'a number', string: 'a string' };

/** A value's kind as the defaults have them; none for an array that is not all strings, or null, which no default is. */
const kindOf = (v: unknown) => (Array.isArray(v) ? (v.every((x) => typeof x === 'string') ? 'list' : undefined) : v === null ? undefined : typeof v);

/** `value` when it has the default's kind (a list of strings for a list, a map of strings for a map); else the field's name. */
function field(name: string, value: unknown, fallback: unknown): unknown {
  if (value === undefined) return fallback;
  const ok = kindOf(value) === kindOf(fallback) && (kindOf(fallback) !== 'object' || nested(name, value as Record<string, unknown>, fallback as Record<string, unknown>));
  if (!ok) throw new Error(`${RUNNER_CONFIG}: ${name} is not ${NAMES[kindOf(fallback) as string]}`);
  return kindOf(fallback) === 'object' ? { ...(fallback as object), ...(value as object) } : value;
}

/** Whether an object field's own fields have their defaults' kinds; the checks map has strings only. */
function nested(name: string, value: Record<string, unknown>, fallback: Record<string, unknown>): boolean {
  if (Object.keys(fallback).length === 0) return Object.values(value).every((v) => typeof v === 'string');
  for (const [k, v] of Object.entries(fallback)) field(`${name}.${k}`, value[k], v);
  return true;
}

/** The settings in config/runner.json's text, defaults for what it leaves out; none (all defaults) for no file. Throws on a broken file. */
export function parseRunnerConfig(text: string | undefined): RunnerConfig {
  if (text === undefined) return DEFAULTS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${RUNNER_CONFIG} is not JSON`);
  }
  if (kindOf(raw) !== 'object') throw new Error(`${RUNNER_CONFIG} is not a JSON object`);
  const file = raw as Record<string, unknown>;
  return perBranch(Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, field(k, file[k], v)])) as unknown as RunnerConfig);
}

/** The settings, when the report name has {branch}: without it every branch would share one report. */
function perBranch(c: RunnerConfig): RunnerConfig {
  if (!c.report.name.includes('{branch}')) throw new Error(`${RUNNER_CONFIG}: report.name has no {branch}`);
  return c;
}

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Whether a repo path matches a pattern: a folder ending in '/' holds it, or the name matches with '*' as any characters but '/'. */
export function matchesPath(path: string, pattern: string): boolean {
  if (pattern.endsWith('/')) return path.startsWith(pattern);
  return new RegExp(`^${pattern.split('*').map(escape).join('[^/]*')}$`).test(path);
}

export const matchesAny = (path: string, patterns: string[]) => patterns.some((p) => matchesPath(path, p));
