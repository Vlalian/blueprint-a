// The .NET adapter for the test-strength gates (gates/test-strength/contract.ts, ticket 30):
// coverage and complexity from one `dotnet test` run with coverlet's collector, which writes
// Cobertura XML per test project; mutants from Stryker.NET's json report (the same
// mutation-testing-elements schema Stryker writes for JS). Complexity is McCabe's, counted from
// coverlet's branch points: 1 plus each decision point's branches beyond the first. Coverlet's own
// `complexity` attribute counts every branch outcome instead (6 for three ifs, not 4), so it is
// not used. Branch points are read from the compiled IL, so a branch the compiler adds and coverlet
// does not filter counts too. Every process, file and temp folder goes through DotnetIo; io.ts
// wires in the real ones. The spike behind these choices is in docs/tickets/30-dotnet-adapter.md.

import { join, relative, resolve, sep } from 'node:path';
import type { FunctionLines, FunctionRef, FunctionScore, Mutant, TestStrengthAdapter } from '../../gates/test-strength/contract.ts';
import type { AdapterOptions } from '../../gates/test-strength/gate.ts';

export interface DotnetIo {
  read(path: string): string;
  exists(path: string): boolean;
  /** Every file called `name` anywhere under `dir`. */
  find(dir: string, name: string): string[];
  /** A fresh, empty temp folder. */
  tempDir(): string;
  remove(dir: string): void;
  /** Runs `dotnet <args>` in the project folder, no shell; `missing` when there is no dotnet to start. */
  dotnet(args: string[]): { status: number | null; output: string; missing: boolean };
}

/** What spawnSync gives back for `dotnet`, as DotnetIo reports it: ENOENT means there is no dotnet to start. */
export function ranDotnet(r: { status: number | null; stdout?: string; stderr?: string; error?: Error }): ReturnType<DotnetIo['dotnet']> {
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  return { status: r.status, output: [r.stdout, r.stderr, r.error?.message].join(''), missing: code === 'ENOENT' };
}

export const INSTALL =
  'dotnet was not found: install the .NET SDK 8 or later (https://dotnet.microsoft.com/download), put dotnet on PATH, and run `dotnet tool restore` in the project for Stryker.NET';

/** One line of a method in coverlet's Cobertura: its hits, and its branches and decision points (0 on a plain line). */
export interface CoberturaLine {
  number: number;
  hits: number;
  branches: number;
  decisions: number;
}

export interface CoberturaMethod {
  /** As coverlet writes it: relative to one of the sources, or absolute. */
  file: string;
  className: string;
  name: string;
  signature: string;
  lines: CoberturaLine[];
}

export interface Cobertura {
  sources: string[];
  methods: CoberturaMethod[];
}

export interface Element {
  name: string;
  attrs: Record<string, string>;
  children: Element[];
  text: string;
}

interface MutationReport {
  files: Record<string, { mutants: Array<{ location: { start: { line: number } }; mutatorName: string; status: string }> }>;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const decode = (text: string) => text.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ENTITIES[e]!);
const TAG = /<(\/?)([\w-]+)([^>]*?)(\/?)>/g;
const ATTR = /([\w-]+)="([^"]*)"/g;

/** Enough XML for coverlet's Cobertura: elements, attributes and text; the prolog is skipped. */
export function parseXml(xml: string): Element {
  const root: Element = { name: '', attrs: {}, children: [], text: '' };
  const open = [root];
  let last = 0;
  for (const m of xml.matchAll(TAG)) {
    open.at(-1)!.text += xml.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] === '/') {
      open.pop();
      continue;
    }
    const element = { name: m[2]!, attrs: Object.fromEntries([...m[3]!.matchAll(ATTR)].map(([, k, v]) => [k, decode(v!)])), children: [], text: '' };
    open.at(-1)!.children.push(element);
    if (m[4] !== '/') open.push(element);
  }
  return root;
}

/** The elements reached from `from` by following child names in order. */
const under = (from: Element[], names: string[]) => names.reduce((level, name) => level.flatMap((e) => e.children.filter((c) => c.name === name)), from);

function lineOf(line: Element): CoberturaLine {
  const valid = /\(\d+\/(\d+)\)/.exec(String(line.attrs['condition-coverage']));
  return { number: Number(line.attrs.number), hits: Number(line.attrs.hits), branches: Number(valid?.[1] ?? 0), decisions: under([line], ['conditions', 'condition']).length };
}

export function parseCobertura(xml: string): Cobertura {
  const coverage = under([parseXml(xml)], ['coverage']);
  const classes = under(coverage, ['packages', 'package', 'classes', 'class']);
  return {
    sources: under(coverage, ['sources', 'source']).map((s) => decode(s.text).trim()),
    methods: classes.flatMap((c) =>
      under([c], ['methods', 'method']).map((m) => ({
        file: c.attrs.filename!,
        className: c.attrs.name!,
        name: m.attrs.name!,
        signature: m.attrs.signature!,
        lines: under([m], ['lines', 'line']).map(lineOf),
      })),
    ),
  };
}

/** McCabe's number from branch points: 1, plus each decision point's branches beyond the first. */
export const complexityOf = (lines: CoberturaLine[]) => lines.reduce((sum, l) => sum + l.branches - l.decisions, 1);

export type MethodRow = FunctionLines & FunctionScore;

/** One method seen in several reports: the same line's hits add up. */
function merged(methods: Array<CoberturaMethod & { key: string }>): Map<string, CoberturaMethod & { key: string }> {
  const byMethod = new Map<string, CoberturaMethod & { key: string }>();
  for (const m of methods) {
    const id = JSON.stringify([m.key, m.className, m.name, m.signature]);
    const seen = byMethod.get(id);
    if (seen === undefined) {
      byMethod.set(id, { ...m, lines: m.lines.map((l) => ({ ...l })) });
      continue;
    }
    for (const l of m.lines) {
      const same = seen.lines.find((s) => s.number === l.number);
      if (same === undefined) seen.lines.push({ ...l });
      else same.hits += l.hits;
    }
  }
  return byMethod;
}

/**
 * Each method of the `wanted` files (project-relative keys) across the reports: its lines, the
 * ones a test ran, and its complexity. `keyOf` turns an absolute path into a key.
 */
export function methodRows(reports: Cobertura[], wanted: string[], keyOf: (abs: string) => string): MethodRow[] {
  const located = reports.flatMap(({ sources, methods }) =>
    methods.flatMap((m) => {
      const key = sources.map((s) => keyOf(resolve(s, m.file))).find((k) => wanted.includes(k));
      return key === undefined || m.lines.length === 0 ? [] : [{ ...m, key }];
    }),
  );
  return [...merged(located).values()].map((m) => {
    const numbers = m.lines.map((l) => l.number);
    const ref: FunctionRef = { file: m.key, name: `${m.className}.${m.name}`, startLine: Math.min(...numbers), endLine: Math.max(...numbers) };
    return { ...ref, lines: m.lines.length, covered: m.lines.filter((l) => l.hits > 0).length, complexity: complexityOf(m.lines) };
  });
}

/** Each mutant of the `wanted` files in a Stryker.NET json report. */
export function mutantsOf(report: MutationReport, wanted: string[], keyOf: (abs: string) => string): Mutant[] {
  return Object.entries(report.files)
    .filter(([file]) => wanted.includes(keyOf(resolve(file))))
    .flatMap(([file, { mutants }]) => mutants.map((m) => ({ file: keyOf(resolve(file)), line: m.location.start.line, mutator: m.mutatorName, status: m.status })));
}

/** `dotnet test` with coverlet's collector, its Cobertura files under `dir`. */
export const COVERAGE_ARGS = (dir: string) => ['test', '--collect', 'XPlat Code Coverage', '--results-directory', dir];

/** `dotnet stryker` on the project (or solution) here, mutating only the named files, a json report under `dir`. */
export const strykerArgs = (dir: string, keys: string[]) => ['stryker', '--reporter', 'json', '--output', dir, ...keys.flatMap((k) => ['--mutate', `**/${k}`])];

export function dotnetAdapter(options: Pick<AdapterOptions, 'cwd' | 'coverageFile'>, io: DotnetIo): TestStrengthAdapter {
  const root = resolve(options.cwd);
  /** Project-relative with forward slashes: the key coverage, Stryker.NET and the gate agree on. */
  const keyOf = (abs: string) => relative(root, abs).split(sep).join('/');
  const keys = (paths: string[]) => paths.map((p) => keyOf(resolve(root, p)));

  function run(args: string[]) {
    const ran = io.dotnet(args);
    if (ran.missing) throw new Error(INSTALL);
    return ran;
  }

  /** Runs `use` with a fresh temp folder and removes the folder afterwards, whatever happens. */
  function inTemp<T>(use: (dir: string) => T): T {
    const dir = io.tempDir();
    try {
      return use(dir);
    } finally {
      io.remove(dir);
    }
  }

  const testRun = () =>
    inTemp((dir) => {
      const { status, output } = run(COVERAGE_ARGS(dir));
      if (status !== 0) throw new Error(`dotnet test exited ${status}; coverage needs a green suite:\n${output}`);
      const files = io.find(dir, 'coverage.cobertura.xml');
      if (files.length === 0) throw new Error(`dotnet test wrote no coverage.cobertura.xml: does every test project reference coverlet.collector?\n${output}`);
      return files.map((f) => io.read(f));
    });

  // complexity() and coverage() come from the same run: the crap gate asks for both.
  let last: { paths: string; rows: MethodRow[] } | undefined;
  function measure(paths: string[]): MethodRow[] {
    if (last?.paths === JSON.stringify(paths)) return last.rows;
    const xml = options.coverageFile === undefined ? testRun() : [io.read(resolve(root, options.coverageFile))];
    const rows = methodRows(xml.map(parseCobertura), keys(paths), keyOf);
    const unseen = keys(paths).filter((k) => !rows.some((r) => r.file === k));
    if (unseen.length > 0) throw new Error(`the coverage has no method in ${unseen.join(', ')}: is it in a project the tests reference?`);
    last = { paths: JSON.stringify(paths), rows };
    return rows;
  }

  return {
    complexity: (paths) => measure(paths).map(({ lines: _l, covered: _c, ...score }) => score),
    coverage: (paths) => measure(paths).map(({ complexity: _, ...lines }) => lines),
    mutate: (paths) =>
      inTemp((dir) => {
        const { output } = run(strykerArgs(dir, keys(paths)));
        const report = join(dir, 'reports', 'mutation-report.json');
        if (!io.exists(report)) throw new Error(`Stryker.NET wrote no report (restore it with \`dotnet tool restore\`):\n${output}`);
        return mutantsOf(JSON.parse(io.read(report)) as MutationReport, keys(paths), keyOf);
      }),
  };
}
