import { describe, it, expect } from 'vitest';
import { scoreCrap, type FileCoverage } from './crap.ts';
import type { FunctionComplexity } from './complexity.ts';

/**
 * CRAP = complexity² × (1 − coverage)³ + complexity (Savoia & Evans, 2007).
 *
 * The shape matters more than the arithmetic: a fully covered function scores
 * exactly its complexity, so `/onkel` Mode A's ceiling of 6 is in effect a
 * complexity cap of 6 for covered code — and an *un*covered function is
 * punished cubically, which is the whole point of the metric.
 */

function fn(over: Partial<FunctionComplexity> = {}): FunctionComplexity {
  return {
    name: 'f',
    file: 'a.ts',
    startLine: 1,
    endLine: 10,
    complexity: 3,
    ...over,
  };
}

/** Coverage where each entry is [line, timesRun]. */
function coverage(...statements: [number, number][]): FileCoverage {
  const statementMap: FileCoverage['statementMap'] = {};
  const s: FileCoverage['s'] = {};
  statements.forEach(([line, count], i) => {
    statementMap[String(i)] = { start: { line }, end: { line } };
    s[String(i)] = count;
  });
  return { statementMap, s };
}

describe('scoreCrap', () => {
  it('scores a fully covered function exactly its complexity', () => {
    // Which is why a ceiling of 6 is a complexity cap of 6 for tested code.
    const [scored] = scoreCrap([fn({ complexity: 4 })], coverage([2, 1], [3, 1]));

    expect(scored.coverage).toBe(1);
    expect(scored.crap).toBe(4);
  });

  it('scores an uncovered function c squared plus c', () => {
    const [scored] = scoreCrap([fn({ complexity: 4 })], coverage([2, 0], [3, 0]));

    expect(scored.coverage).toBe(0);
    expect(scored.crap).toBe(20);
  });

  it('punishes partial coverage cubically, not linearly', () => {
    // Half-covered is much worse than half as bad — 3² × 0.5³ + 3 = 4.125.
    const [scored] = scoreCrap([fn({ complexity: 3 })], coverage([2, 1], [3, 0]));

    expect(scored.coverage).toBe(0.5);
    expect(scored.crap).toBeCloseTo(4.125, 5);
  });

  it('treats a function with no executable statements as covered', () => {
    // Not a division by zero, and not a 0% score: there was nothing to run, so
    // there is nothing untested to punish.
    const [scored] = scoreCrap([fn({ complexity: 1 })], coverage());

    expect(scored.coverage).toBe(1);
    expect(scored.crap).toBe(1);
  });

  it("includes the function's own first and last lines", () => {
    // Off-by-one at either end silently mis-attributes coverage, and the score
    // still looks plausible — which is the worst kind of wrong for a gate.
    const [scored] = scoreCrap(
      [fn({ startLine: 5, endLine: 7, complexity: 1 })],
      coverage([4, 1], [5, 0], [7, 0], [8, 1]),
    );

    expect(scored.coverage).toBe(0);
  });

  it('does not treat an identical range as a nested function', () => {
    // Two entries for the same span would otherwise cancel each other out and
    // report a function as having no statements of its own.
    const a = fn({ name: 'a', startLine: 1, endLine: 5, complexity: 2 });
    const b = fn({ name: 'b', startLine: 1, endLine: 5, complexity: 2 });

    const scored = scoreCrap([a, b], coverage([3, 0]));

    expect(scored.map((f) => f.coverage)).toEqual([0, 0]);
  });

  it('does not treat a function in another file as nested', () => {
    const outer = fn({ name: 'outer', file: 'a.ts', startLine: 1, endLine: 9, complexity: 1 });
    const elsewhere = fn({ name: 'elsewhere', file: 'b.ts', startLine: 3, endLine: 5, complexity: 1 });

    const scored = scoreCrap([outer, elsewhere], coverage([4, 0]));

    expect(scored.find((f) => f.name === 'outer')!.coverage).toBe(0);
  });

  it('counts only statements inside the function', () => {
    const [scored] = scoreCrap(
      [fn({ startLine: 5, endLine: 7, complexity: 2 })],
      coverage([1, 0], [6, 1], [20, 0]),
    );

    expect(scored.coverage).toBe(1);
  });

  it("does not charge a parent for its nested function's uncovered lines", () => {
    // Complexity already scores a nested function separately. If coverage did
    // not, an untested callback would drag down the function that merely holds
    // it, and hoisting the callback out would "fix" the parent's score.
    const outer = fn({ name: 'outer', startLine: 1, endLine: 10, complexity: 2 });
    const inner = fn({ name: 'inner', startLine: 4, endLine: 6, complexity: 1 });

    const scored = scoreCrap([outer, inner], coverage([2, 1], [5, 0], [9, 1]));

    expect(scored.find((f) => f.name === 'outer')!.coverage).toBe(1);
    expect(scored.find((f) => f.name === 'inner')!.coverage).toBe(0);
  });

  it('scores every function with no coverage data at all as uncovered', () => {
    // A file the test run never loaded reports nothing, which is not the same
    // as a file whose statements all ran. Treating a missing file as covered
    // would make deleting a test the cheapest way to pass.
    const [scored] = scoreCrap([fn({ complexity: 3 })], undefined);

    expect(scored.coverage).toBe(0);
    expect(scored.crap).toBe(12);
  });
});

describe('scoreCrap — the boundaries a gate stands or falls on', () => {
  it('attributes a statement on the function\'s first line to that function', () => {
    // Covered first line, uncovered middle: 50%. If the first line were
    // excluded the answer would be 0%, and a gate that mis-attributes by one
    // line still reports a plausible-looking number.
    const [scored] = scoreCrap(
      [fn({ startLine: 5, endLine: 9, complexity: 2 })],
      coverage([5, 1], [7, 0]),
    );

    expect(scored.coverage).toBe(0.5);
  });

  it("attributes a statement on the function's last line to that function", () => {
    const [scored] = scoreCrap(
      [fn({ startLine: 5, endLine: 9, complexity: 2 })],
      coverage([7, 0], [9, 1]),
    );

    expect(scored.coverage).toBe(0.5);
  });

  it('excludes the nested function\'s own first and last lines from the parent', () => {
    const outer = fn({ name: 'outer', startLine: 1, endLine: 10, complexity: 2 });
    const inner = fn({ name: 'inner', startLine: 4, endLine: 6, complexity: 1 });

    // Lines 4 and 6 are the nested function's edges and belong to it; only
    // line 2 is the parent's, and it ran.
    const scored = scoreCrap([outer, inner], coverage([2, 1], [4, 0], [6, 0]));

    expect(scored.find((f) => f.name === 'outer')!.coverage).toBe(1);
    expect(scored.find((f) => f.name === 'inner')!.coverage).toBe(0);
  });

  it('treats a function starting on the parent\'s first line as nested', () => {
    const outer = fn({ name: 'outer', startLine: 1, endLine: 10, complexity: 1 });
    const inner = fn({ name: 'inner', startLine: 1, endLine: 4, complexity: 1 });

    const scored = scoreCrap([outer, inner], coverage([2, 0], [7, 1]));

    expect(scored.find((f) => f.name === 'outer')!.coverage).toBe(1);
  });

  it('treats a function ending on the parent\'s last line as nested', () => {
    const outer = fn({ name: 'outer', startLine: 1, endLine: 10, complexity: 1 });
    const inner = fn({ name: 'inner', startLine: 6, endLine: 10, complexity: 1 });

    const scored = scoreCrap([outer, inner], coverage([2, 1], [8, 0]));

    expect(scored.find((f) => f.name === 'outer')!.coverage).toBe(1);
  });

  it('excludes exactly the nested range — not a line either side of it', () => {
    // Chosen so that *any* slip changes the answer: the parent's own two
    // statements differ in coverage, so wrongly excluding either one, or
    // wrongly including the nested one, moves the fraction off 50%.
    const outer = fn({ name: 'outer', startLine: 1, endLine: 10, complexity: 2 });
    const inner = fn({ name: 'inner', startLine: 5, endLine: 6, complexity: 1 });

    const scored = scoreCrap([outer, inner], coverage([2, 0], [5, 1], [8, 1]));

    expect(scored.find((f) => f.name === 'outer')!.coverage).toBe(0.5);
  });

  it('does not treat a function starting before the parent as nested', () => {
    const outer = fn({ name: 'outer', startLine: 5, endLine: 20, complexity: 1 });
    const earlier = fn({ name: 'earlier', startLine: 1, endLine: 9, complexity: 1 });

    const scored = scoreCrap([outer, earlier], coverage([7, 0]));

    expect(scored.find((f) => f.name === 'outer')!.coverage).toBe(0);
  });

  it('does not treat an overlapping-but-wider function as nested', () => {
    // Only containment is nesting. A range that starts inside and ends outside
    // is not a nested function; it is a bug in whoever produced the ranges.
    const outer = fn({ name: 'outer', startLine: 5, endLine: 9, complexity: 1 });
    const overlapping = fn({ name: 'other', startLine: 7, endLine: 20, complexity: 1 });

    const scored = scoreCrap([outer, overlapping], coverage([8, 0]));

    expect(scored.find((f) => f.name === 'outer')!.coverage).toBe(0);
  });
});
