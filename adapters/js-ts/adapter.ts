// The JavaScript/TypeScript adapter for the test-strength gates (gates/test-strength/contract.ts,
// ticket 20): complexity from the TypeScript AST (gates/onkel/complexity.ts), coverage from one
// run of the project's test runner (vitest, Jest) as istanbul json, mutants from Stryker with the
// matching test-runner plugin. Karma has no coverage command of its own here: the project's
// karma.conf writes istanbul json with karma-coverage and the gate is handed that file
// (--coverage). Every process, file and temp folder goes through JsTsIo; io.ts wires in the real ones.

import { join, relative, resolve, sep } from 'node:path';
import { measureComplexity, type FunctionComplexity } from '../../gates/onkel/complexity.ts';
import type { FunctionLines, FunctionScore, Mutant, TestStrengthAdapter } from '../../gates/test-strength/contract.ts';
import type { AdapterOptions, JsRunner } from '../../gates/test-strength/gate.ts';

export type Tool = JsRunner | 'stryker';

/** Each tool's package and the JS entry its bin starts, run as `node <entry>` (npx is a .cmd shim on Windows). */
export const BINS: Record<Tool, [pkg: string, entry: string]> = {
  vitest: ['vitest', 'vitest.mjs'],
  jest: ['jest', 'bin/jest.js'],
  karma: ['karma', 'bin/karma'],
  stryker: ['@stryker-mutator/core', 'bin/stryker.js'],
};

export interface JsTsIo {
  read(path: string): string;
  exists(path: string): boolean;
  write(path: string, text: string): void;
  /** A fresh, empty temp folder. */
  tempDir(): string;
  remove(dir: string): void;
  /** Runs a package's bin as `node <its entry>` in the project folder: no shell, no npx. */
  runBin(tool: Tool, args: string[]): { status: number | null; output: string };
}

/** The part of istanbul's per-file coverage this reads. */
export interface FileCoverage {
  statementMap: Record<string, { start: { line: number } }>;
  /** Statement id to how many times it ran. */
  s: Record<string, number>;
}

interface StrykerReport {
  files: Record<string, { mutants: Array<{ location: { start: { line: number } }; mutatorName: string; status: string }> }>;
}

const KARMA = "karma: run karma with karma-coverage's json reporter and pass its coverage-final.json with --coverage";

/** The runner's arguments for one coverage run of the whole suite, as istanbul json in `dir`. */
export function coverageArgs(runner: JsRunner, dir: string, paths: string[]): string[] {
  if (runner === 'vitest') {
    return ['run', '--coverage.enabled', '--coverage.provider=v8', '--coverage.reporter=json', `--coverage.reportsDirectory=${dir}`, ...paths.map((p) => `--coverage.include=${p}`)];
  }
  if (runner === 'jest') return ['--ci', '--coverage', '--coverageReporters=json', `--coverageDirectory=${dir}`, ...paths.map((p) => `--collectCoverageFrom=${p}`)];
  throw new Error(KARMA);
}

/** Stryker's config: only the named files, the chosen runner, a json report in `dir`. */
export function strykerConfig(runner: JsRunner, paths: string[], dir: string): Record<string, unknown> {
  const perRunner = { vitest: {}, jest: { jest: { projectType: 'custom' } }, karma: { karma: { configFile: 'karma.conf.js' } } }[runner];
  return {
    testRunner: runner,
    mutate: paths,
    coverageAnalysis: 'perTest',
    reporters: ['json'],
    jsonReporter: { fileName: join(dir, 'mutation.json') },
    tempDirName: join(dir, 'stryker-tmp'),
    cleanTempDir: true,
    ...perRunner,
  };
}

/** Whether `inner` is another function inside `outer`'s lines. */
const nestedIn = (inner: FunctionScore, outer: FunctionScore) => inner !== outer && inner.startLine >= outer.startLine && inner.endLine <= outer.endLine;

const within = (line: number, fn: FunctionScore) => line >= fn.startLine && line <= fn.endLine;

/** Each function's own lines (a nested function's are its own) and those a test ran; all from one file. */
export function functionLines(functions: FunctionScore[], coverage: FileCoverage): FunctionLines[] {
  return functions.map((fn) => {
    const nested = functions.filter((other) => nestedIn(other, fn));
    const own = Object.entries(coverage.statementMap).filter(([, { start }]) => within(start.line, fn) && !nested.some((n) => within(start.line, n)));
    const lines = new Set(own.map(([, { start }]) => start.line));
    const covered = new Set(own.filter(([id]) => (coverage.s[id] ?? 0) > 0).map(([, { start }]) => start.line));
    const { complexity: _, ...ref } = fn;
    return { ...ref, lines: lines.size, covered: covered.size };
  });
}

/** Runs `use` with a fresh temp folder and removes the folder afterwards, whatever happens. */
function inTemp<T>(io: JsTsIo, use: (dir: string) => T): T {
  const dir = io.tempDir();
  try {
    return use(dir);
  } finally {
    io.remove(dir);
  }
}

export function jsTsAdapter(options: AdapterOptions<JsRunner>, io: JsTsIo): TestStrengthAdapter {
  const root = resolve(options.cwd);
  const at = (path: string) => resolve(root, path);
  /** Project-relative with forward slashes: the key coverage, Stryker and the gate agree on. */
  const key = (path: string) => relative(root, at(path)).split(sep).join('/');

  const complexity = (paths: string[]): FunctionComplexity[] => paths.flatMap((p) => measureComplexity(key(p), io.read(at(p))));

  function runCoverage(paths: string[]): string {
    return inTemp(io, (dir) => {
      const { status, output } = io.runBin(options.runner, coverageArgs(options.runner, dir, paths));
      if (status !== 0) throw new Error(`${options.runner} exited ${status}; coverage needs a green suite:\n${output}`);
      return io.read(join(dir, 'coverage-final.json'));
    });
  }

  function coverage(paths: string[]): FunctionLines[] {
    const json = options.coverageFile === undefined ? runCoverage(paths) : io.read(at(options.coverageFile));
    const byFile = new Map(Object.entries(JSON.parse(json) as Record<string, FileCoverage>).map(([file, cov]) => [key(file), cov]));
    const scores = complexity(paths);
    return [...new Set(scores.map((fn) => fn.file))].flatMap((file) => {
      const cov = byFile.get(file);
      return cov === undefined ? [] : functionLines(scores.filter((fn) => fn.file === file), cov);
    });
  }

  function mutate(paths: string[]): Mutant[] {
    return inTemp(io, (dir) => {
      const config = join(dir, 'stryker.json');
      io.write(config, JSON.stringify(strykerConfig(options.runner, paths, dir)));
      // Stryker exits non-zero when a mutant survives: a verdict for the gate, not a crash.
      const { output } = io.runBin('stryker', ['run', config]);
      const reportPath = join(dir, 'mutation.json');
      if (!io.exists(reportPath)) throw new Error(`Stryker wrote no report:\n${output}`);
      const report = JSON.parse(io.read(reportPath)) as StrykerReport;
      return Object.entries(report.files).flatMap(([file, { mutants }]) =>
        mutants.map((m) => ({ file: key(file), line: m.location.start.line, mutator: m.mutatorName, status: m.status })),
      );
    });
  }

  return { complexity, coverage, mutate };
}
