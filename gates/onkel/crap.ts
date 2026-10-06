import type { FunctionComplexity } from './complexity.ts';

/**
 * The CRAP score: `complexity² × (1 − coverage)³ + complexity`
 * (Savoia & Evans, 2007, "Change Risk Analysis and Predictions").
 *
 * Pure: complexity and coverage in, numbers out, no filesystem.
 *
 * Two properties are worth stating because the ceiling depends on them. A
 * fully covered function scores **exactly its complexity**, so `/onkel` Mode
 * A's ceiling of 6 is a complexity cap of 6 for tested code — that is the
 * intent, not a side effect. And an uncovered function is punished *cubically*
 * as coverage falls, so the metric says "complex and untested" much louder
 * than it says either one alone.
 *
 * Coverage is attributed by **line range**, not by function name: the
 * v8-to-istanbul conversion does not preserve names reliably, and a range is
 * something both halves of this tool can agree on.
 */

/** The part of istanbul's per-file coverage this needs. */
export type FileCoverage = {
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  /** Statement id → how many times it ran. */
  s: Record<string, number>;
};

export type CrapScore = FunctionComplexity & {
  /** Fraction of the function's own statements that ran, 0–1. */
  coverage: number;
  crap: number;
};

/** Whether `inner` sits strictly inside `outer`'s lines. */
function isNestedIn(inner: FunctionComplexity, outer: FunctionComplexity): boolean {
  if (inner.file !== outer.file) return false;
  // An identical range is not nesting, which also covers a function compared
  // with itself — an explicit `inner === outer` guard here was dead weight,
  // and the mutation run is what found it.
  const sameSpan = inner.startLine === outer.startLine && inner.endLine === outer.endLine;
  return inner.startLine >= outer.startLine && inner.endLine <= outer.endLine && !sameSpan;
}

/**
 * Scores every function, attributing each statement to the innermost function
 * that contains it.
 *
 * `coverage` is undefined when the test run never loaded the file. That is
 * deliberately scored as 0% rather than skipped: treating an unloaded file as
 * covered would make deleting its test the cheapest way to pass the gate.
 */
export function scoreCrap(
  functions: FunctionComplexity[],
  coverage: FileCoverage | undefined,
): CrapScore[] {
  return functions.map((fn) => {
    const nested = functions.filter((other) => isNestedIn(other, fn));

    const own = coverage
      ? Object.entries(coverage.statementMap).filter(([, { start }]) => {
          if (start.line < fn.startLine || start.line > fn.endLine) return false;
          // A statement inside a nested function belongs to that function, not
          // to this one — the same rule complexity already applies, so an
          // untested callback cannot drag down the function that holds it.
          return !nested.some((n) => start.line >= n.startLine && start.line <= n.endLine);
        })
      : [];

    // No statements is not zero coverage: there was nothing to run, so there
    // is nothing untested to punish. A missing file, however, is.
    const ran = own.filter(([id]) => (coverage!.s[id] ?? 0) > 0).length;
    const covered = coverage === undefined ? 0 : own.length === 0 ? 1 : ran / own.length;

    const { complexity } = fn;
    const crap = complexity ** 2 * (1 - covered) ** 3 + complexity;

    return { ...fn, coverage: covered, crap };
  });
}
