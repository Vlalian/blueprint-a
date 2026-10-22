// The test-strength gates, read through the adapter interface (contract.ts), so they hold for any
// language an adapter exists for (ticket 20). Two gates, each with the gate contract
// (gates/lib/contract.ts):
// - crap: every function on the named paths scores CRAP <= the ceiling (6), where
//   CRAP = complexity^2 x (1 - coverage)^3 + complexity, so a fully covered function scores its
//   complexity and an untested one is punished cubically;
// - mutation: every mutant on the named paths is killed (or timed out, or did not compile), and an
//   ignored one sits under a line-level `disable next-line <mutator>: <reason>` naming it (ticket 74).
// cli.ts wires in the adapter the runner names (adapters/js-ts, or adapters/dotnet for `dotnet`);
// this module decides.

import { parseArgs } from 'node:util';
import type { GateResult } from '../lib/contract.ts';
import { suppressionReason } from '../onkel/suppressions.ts';
import type { FunctionLines, FunctionRef, Mutant, TestStrengthAdapter } from './contract.ts';

export const CRAP_CEILING = 6;
export const RUNNERS = ['vitest', 'jest', 'karma', 'dotnet'] as const;
export type Runner = (typeof RUNNERS)[number];
/** The runners adapters/js-ts drives; `dotnet` is adapters/dotnet's (ticket 30). */
export type JsRunner = Exclude<Runner, 'dotnet'>;

/** What a gate's adapter is made from: the test runner, the project folder, a coverage file it already has. */
export interface AdapterOptions<R extends Runner = Runner> {
  runner: R;
  cwd: string;
  coverageFile: string | undefined;
}

/** One AdapterOptions per runner, so checking `runner` narrows the whole options to one adapter's. */
export type AnyAdapterOptions = { [R in Runner]: AdapterOptions<R> }[Runner];

const USAGE = 'usage: test-strength <crap|mutation> [--runner vitest|jest|karma|dotnet] [--cwd <dir>] [--coverage <coverage-final.json|coverage.cobertura.xml>] [--ceiling <n>] <path...>';
// Stryker's statuses that mean a test noticed the mutant.
const DETECTED = new Set(['Killed', 'Timeout', 'CompileError']);

/** Savoia and Evans' CRAP score; a function with no lines of its own has nothing untested. */
export function crapScore(complexity: number, lines: number, covered: number): number {
  const coverage = lines === 0 ? 1 : covered / lines;
  return complexity ** 2 * (1 - coverage) ** 3 + complexity;
}

const identity = (fn: FunctionRef) => JSON.stringify([fn.file, fn.name, fn.startLine, fn.endLine, fn.startColumn, fn.endColumn]);
const same = (a: FunctionRef, b: FunctionRef) => identity(a) === identity(b);

/** A function's lines; one untested line when the coverage never reached it, so it is never read as covered. */
const linesOf = (fn: FunctionRef, measured: FunctionLines[]) => measured.find((l) => same(l, fn)) ?? { lines: 1, covered: 0 };

export function crapGate(paths: string[], adapter: TestStrengthAdapter, ceiling = CRAP_CEILING): GateResult {
  const scores = adapter.complexity(paths);
  const measured = adapter.coverage(paths);
  const graded = scores.map((fn) => {
    const { lines, covered } = linesOf(fn, measured);
    return { ...fn, coverage: lines === 0 ? 1 : covered / lines, crap: crapScore(fn.complexity, lines, covered) };
  });
  const over = graded.filter((fn) => fn.crap > ceiling);
  return { gate: 'crap', pass: over.length === 0, ceiling, functions: graded.length, over };
}

/** A project file's text by its project-relative path, as the adapter names it; undefined when it cannot be read. */
export type SourceReader = (file: string) => string | undefined;

/**
 * Ticket 74: whether an ignored mutant sits under a line-level directive that names its mutator and
 * gives a reason, read from the source as onkel reads it. A file-level, block-level or `all` ignore, a
 * config ignore, a directive without a reason, or a file that cannot be read is not.
 */
function verified(m: Mutant, sourceOf: SourceReader): boolean {
  const source = sourceOf(m.file);
  const found = source === undefined ? null : suppressionReason(source, m.line);
  return found !== null && found.reason !== null && !found.mutators.includes('all') && found.mutators.includes(m.mutator.toLowerCase());
}

export function mutationGate(paths: string[], adapter: TestStrengthAdapter, sourceOf: SourceReader): GateResult {
  const mutants = adapter.mutate(paths);
  const suppressed = mutants.filter((m: Mutant) => m.status === 'Ignored');
  const ignored = suppressed.filter((m) => verified(m, sourceOf));
  const unverified = suppressed.filter((m) => !ignored.includes(m));
  const standing = mutants.filter((m: Mutant) => !DETECTED.has(m.status) && m.status !== 'Ignored');
  const result = { gate: 'mutation', mutants: mutants.length, standing, ignored, unverified };
  if (mutants.length === 0) return { ...result, pass: false, reason: 'nothing was mutated; name source files that hold code' };
  return { ...result, pass: standing.length === 0 && unverified.length === 0 };
}

const isRunner = (r: string): r is Runner => (RUNNERS as readonly string[]).includes(r);

function parse(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { runner: { type: 'string', default: 'vitest' }, cwd: { type: 'string', default: '.' }, coverage: { type: 'string' }, ceiling: { type: 'string' } },
  });
  const [gate, ...paths] = positionals;
  const ceiling = Number(values.ceiling ?? CRAP_CEILING);
  if (!['crap', 'mutation'].includes(gate!) || paths.length === 0 || !isRunner(values.runner) || Number.isNaN(ceiling)) throw new Error(USAGE);
  const options: AnyAdapterOptions = { runner: values.runner, cwd: values.cwd, coverageFile: values.coverage };
  return { gate, paths, ceiling, options };
}

/**
 * The CLI's whole decision: which gate, through which adapter. readSource reads a file of the project
 * folder (--cwd), to check an ignored mutant's directive. Throws the usage on bad arguments.
 */
export function testStrengthGate(args: string[], adapterFor: (options: AnyAdapterOptions) => TestStrengthAdapter, readSource: (cwd: string, file: string) => string | undefined): GateResult {
  const { gate, paths, ceiling, options } = parse(args);
  const adapter = adapterFor(options);
  return gate === 'crap' ? crapGate(paths, adapter, ceiling) : mutationGate(paths, adapter, (file) => readSource(options.cwd, file));
}
