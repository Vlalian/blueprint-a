// The Python adapter for the test-strength gates (gates/test-strength/contract.ts, ticket 99):
// coverage from coverage.py's JSON report, whose per-function regions (coverage 7.10 or later) give
// each function's own statements and the ones the tests ran; complexity from `radon cc -j`; the two
// joined by the function's first line, which coverage and radon both give and which two functions
// of a file never share (names can: a method and a function, a redefinition). Mutants come from
// cosmic-ray: its baseline first, then init, exec and dump. A failed baseline, an incompetent
// mutant (the test command never ran, which cosmic-ray's own summary still counts as 0 survivors)
// or a mutant it never executed is "could not run", never a pass. The tools run from the project's
// Python (toolchain.ts); every file and temp folder goes through PythonIo, io.ts wires in the real
// ones. The spike behind these choices is in docs/tickets/99-python-gates.md.

import { dirname, join, relative, resolve, sep } from 'node:path';
import type { FunctionLines, FunctionScore, Mutant, TestStrengthAdapter } from '../../gates/test-strength/contract.ts';
import type { AdapterOptions } from '../../gates/test-strength/gate.ts';
import type { AddedLine } from '../../gates/lib/diff.ts';
import { isTestFile } from '../../gates/lib/test-files.ts';
import type { PythonToolchain, Ran } from './toolchain.ts';

export interface PythonIo {
  read(path: string): string;
  write(path: string, text: string): void;
  /** A fresh, empty temp folder. */
  tempDir(): string;
  remove(dir: string): void;
  /** The .py files under a folder, absolute; a file is itself. */
  pyFiles(path: string): string[];
  /** The lines added since a git ref, untracked files whole, by project-relative file (gates/lib/changes.ts). */
  changedLines(base: string): AddedLine[];
  tools: PythonToolchain;
}

/** A function's region in coverage.py's JSON: its first line, and its own statements run and not run. */
export interface Region {
  startLine: number;
  executed: number[];
  missing: number[];
}

export type Block = FunctionScore;
export type Row = FunctionLines & FunctionScore;

const slashed = (p: string) => p.replaceAll('\\', '/');

type RadonBlock = { type: string; name: string; lineno: number; endline: number; complexity: number; classname?: string; closures?: RadonBlock[] };

function flatten(file: string, b: RadonBlock, prefix: string): Block[] {
  const name = `${prefix}${b.classname === undefined ? '' : `${b.classname}.`}${b.name}`;
  const own = { file, name, startLine: b.lineno, endLine: b.endline, complexity: b.complexity };
  return [own, ...(b.closures ?? []).flatMap((c) => flatten(file, c, `${name}.`))];
}

/** Every function, method and closure in `radon cc -j` output. Methods are listed flat beside their class, so classes are left out. */
export function parseRadon(json: string, keyOf: (path: string) => string): Block[] {
  const report = JSON.parse(json) as Record<string, RadonBlock[] | { error: string }>;
  return Object.entries(report).flatMap(([path, blocks]) => {
    const file = keyOf(slashed(path));
    if (!Array.isArray(blocks)) throw new Error(`radon could not read ${file}: ${blocks.error}`);
    return blocks.filter((b) => b.type !== 'class').flatMap((b) => flatten(file, b, ''));
  });
}

type CoverageFile = { functions?: Record<string, { start_line: number; executed_lines: number[]; missing_lines: number[] }> };

/** Each file's function regions in coverage.py's JSON report (`coverage json`), by project key. */
export function parseCoverage(json: string, keyOf: (path: string) => string): Map<string, Region[]> {
  const report = JSON.parse(json) as { meta?: { version?: string }; files: Record<string, CoverageFile> };
  return new Map(
    Object.entries(report.files).map(([path, f]) => {
      const file = keyOf(slashed(path));
      if (f.functions === undefined) throw new Error(`coverage.py ${report.meta?.version ?? '(unknown version)'} wrote no function regions for ${file}: install coverage 7.10 or later`);
      // The module's own statements are the region named "".
      const regions = Object.entries(f.functions).filter(([name]) => name !== '');
      return [file, regions.map(([, r]) => ({ startLine: r.start_line, executed: r.executed_lines, missing: r.missing_lines }))];
    }),
  );
}

/** Each function's complexity with its own lines and the ones the tests ran, joined by file and first line. */
export function rowsOf(blocks: Block[], coverage: Map<string, Region[]>): Row[] {
  return blocks.map((b) => {
    const regions = coverage.get(b.file);
    if (regions === undefined) throw new Error(`the coverage has no record of ${b.file}: do the tests import it?`);
    const region = regions.find((r) => r.startLine === b.startLine);
    if (region === undefined) throw new Error(`the coverage has no function at ${b.file}:${b.startLine} (${b.name})`);
    return { ...b, lines: region.executed.length + region.missing.length, covered: region.executed.length };
  });
}

type Work = { mutations: Array<{ module_path: string; operator_name: string; start_pos: [number, number] }> };
type Result = { worker_outcome: string; test_outcome: string | null; output: string } | null;

const STATUS = new Map<string | null, string>([['killed', 'Killed'], ['survived', 'Survived']]);

/** The mutants in `cosmic-ray dump` output (one JSON [work item, result] per line); throws when any could not be tested. */
export function mutantsOfDump(text: string, keyOf: (path: string) => string): Mutant[] {
  const items = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as [Work, Result])
    .filter(([, r]) => r?.worker_outcome !== 'skipped');
  const located = items.map(([work, result]) => {
    const m = work.mutations[0]!;
    return { file: keyOf(slashed(m.module_path)), line: m.start_pos[0], mutator: m.operator_name, result };
  });
  const why = ({ result }: (typeof located)[number]) => {
    if (result === null) return 'not executed';
    if (result.worker_outcome !== 'normal') return result.worker_outcome;
    if (result.test_outcome === 'incompetent') return 'incompetent: the test command did not run';
    return STATUS.has(result.test_outcome) ? undefined : `outcome ${result.test_outcome}`;
  };
  const untested = located.filter((m) => why(m) !== undefined);
  if (untested.length > 0) {
    const first = untested[0]!;
    const said = first.result?.output.trim().split(/\r?\n/)[0];
    throw new Error(`cosmic-ray could not test ${untested.length} of ${located.length} mutants (${why(first)}), first ${first.file}:${first.line} ${first.mutator}${said ? `: ${said}` : ''}`);
  }
  return located.map(({ file, line, mutator, result }) => ({ file, line, mutator, status: STATUS.get(result!.test_outcome)! }));
}

/**
 * The named files a change since the ticket's base touched, each with the lines it added (ticket 99,
 * fix round 1): mutation is held to those lines, as onkel holds JS, so a survivor on code the change
 * never touched does not fail it. Read from git here, untracked files whole, because the gates run
 * before the role's work is committed; cosmic-ray's own git filter sees no untracked file, and its
 * line filter takes one module only.
 */
export function changeScope(files: string[], changed: AddedLine[]): Map<string, Set<number>> {
  const scope = new Map(files.map((f) => [f, new Set<number>()]));
  for (const { file, line } of changed) scope.get(file)?.add(line);
  return new Map([...scope].filter(([, lines]) => lines.size > 0));
}

/** The mutants on the scope's lines; all of them when there is no scope. */
const inScope = (mutants: Mutant[], scope: Map<string, Set<number>> | undefined) => (scope === undefined ? mutants : mutants.filter((m) => scope.get(m.file)?.has(m.line)));

const tomlString = (s: string) => `'${s}'`;

/**
 * cosmic-ray's config: the named modules, and pytest run by the Python's absolute path. A relative
 * one makes every mutant incompetent on Windows (ticket 99), so the path is absolute, with forward
 * slashes (cosmic-ray splits the command shell-style) and quoted for spaces.
 */
export function cosmicConfig(python: string, modules: string[]): string {
  const command = `"${slashed(python)}" -m pytest -x -q -p no:cacheprovider`;
  return [
    '[cosmic-ray]',
    `module-path = [${modules.map(tomlString).join(', ')}]`,
    'timeout = 120.0',
    'excluded-modules = []',
    `test-command = ${tomlString(command)}`,
    '',
    '[cosmic-ray.distributor]',
    `name = ${tomlString('local')}`,
    '',
  ].join('\n');
}

const said = (r: Ran) => [r.stdout, r.stderr, r.error?.message].filter(Boolean).join('\n').trim();

export function pythonAdapter(options: Pick<AdapterOptions, 'cwd' | 'coverageFile' | 'base'>, io: PythonIo): TestStrengthAdapter {
  const root = resolve(options.cwd);
  /** Project-relative with forward slashes: the key coverage, radon, cosmic-ray and the gate agree on. */
  const keyOf = (abs: string) => relative(root, abs).split(sep).join('/');
  const fromProject = (path: string) => keyOf(resolve(root, path));
  /** The named files, and the .py files under the named folders, without tests. */
  const keys = (paths: string[]) => [...new Set(paths.flatMap((p) => io.pyFiles(resolve(root, p)).map(keyOf)))].filter((k) => !isTestFile(k));

  function inTemp<T>(use: (dir: string) => T): T {
    const dir = io.tempDir();
    try {
      return use(dir);
    } finally {
      io.remove(dir);
    }
  }

  const testRun = (files: string[]) =>
    inTemp((dir) => {
      io.tools.require('pytest');
      const data = join(dir, '.coverage');
      const source = [...new Set(files.map((f) => slashed(dirname(f))))].join(',');
      const ran = io.tools.run('coverage', ['run', '--data-file', data, '--source', source, '-m', 'pytest', '-q', '-p', 'no:cacheprovider']);
      if (ran.status !== 0) throw new Error(`pytest exited ${ran.status}; coverage needs a green suite:\n${said(ran)}`);
      const report = join(dir, 'coverage.json');
      const json = io.tools.run('coverage', ['json', '--data-file', data, '-o', report, '-q']);
      if (json.status !== 0) throw new Error(`coverage json exited ${json.status}:\n${said(json)}`);
      return io.read(report);
    });

  // complexity() and coverage() come from the same run: the crap gate asks for both.
  let last: { paths: string; rows: Row[] } | undefined;
  function measure(paths: string[]): Row[] {
    if (last?.paths === JSON.stringify(paths)) return last.rows;
    io.tools.python(); // A missing Python is named before any path is read.
    const files = keys(paths);
    const coverage = options.coverageFile === undefined ? testRun(files) : io.read(resolve(root, options.coverageFile));
    const radon = io.tools.run('radon', ['cc', '-j', ...files]);
    if (radon.status !== 0) throw new Error(`radon exited ${radon.status}:\n${said(radon)}`);
    const rows = rowsOf(parseRadon(radon.stdout, fromProject), parseCoverage(coverage, fromProject));
    last = { paths: JSON.stringify(paths), rows };
    return rows;
  }

  function cosmicRay(step: string, args: string[]): Ran {
    const ran = io.tools.run('cosmic-ray', [step, ...args]);
    if (step === 'baseline' && ran.status !== 0) throw new Error(`cosmic-ray baseline failed (exit ${ran.status}): the tests must pass on unmutated code:\n${said(ran)}`);
    if (ran.status !== 0) throw new Error(`cosmic-ray ${step} exited ${ran.status}:\n${said(ran)}`);
    return ran;
  }

  const mutateFiles = (files: string[]) =>
    inTemp((dir) => {
      io.tools.require('pytest');
      const config = join(dir, 'cosmic-ray.toml');
      const session = join(dir, 'session.sqlite');
      io.write(config, cosmicConfig(io.tools.python(), files));
      cosmicRay('baseline', [config]);
      cosmicRay('init', [config, session]);
      cosmicRay('exec', [config, session]);
      return mutantsOfDump(cosmicRay('dump', [session]).stdout, fromProject);
    });

  return {
    complexity: (paths) => measure(paths).map(({ lines: _l, covered: _c, ...score }) => score),
    coverage: (paths) => measure(paths).map(({ complexity: _, ...lines }) => lines),
    mutate: (paths) => {
      const scope = options.base === undefined ? undefined : changeScope(keys(paths), io.changedLines(options.base));
      const files = scope === undefined ? keys(paths) : [...scope.keys()];
      return files.length === 0 ? [] : inScope(mutateFiles(files), scope);
    },
  };
}
