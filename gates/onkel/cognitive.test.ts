import { describe, it, expect } from 'vitest';
import { measureCognitive } from './cognitive.ts';
import { measureComplexity, type FunctionRef } from './complexity.ts';

/**
 * Cognitive complexity, counted from the TypeScript AST.
 *
 * These rules are the specification. Nothing gates on this number today, but
 * an unasserted diagnostic is free to drift into saying nothing — and the
 * whole reason to print it is that it disagrees with cyclomatic complexity in
 * specific, deliberate places. Each of those places gets a test.
 */

/** The score of the single outermost function in `source`. */
function scoreOne(source: string): number {
  const [only] = measureCognitive('t.ts', source);
  return only.cognitive;
}

describe('measureCognitive — the base cost of each structure', () => {
  it('scores a branchless function 0, where cyclomatic starts at 1', () => {
    // Nothing to hold in your head is nothing to charge for.
    expect(scoreOne('function f() { return 1; }')).toBe(0);
  });

  it.each([
    ['if', 'function f(a: number) { if (a) return 1; return 2; }'],
    ['for', 'function f(a: number[]) { for (const x of a) console.log(x); }'],
    ['for-in', 'function f(o: object) { for (const k in o) console.log(k); }'],
    ['while', 'function f(a: number) { while (a) a--; }'],
    ['do-while', 'function f(a: number) { do { a--; } while (a); }'],
    ['ternary', 'function f(a: number) { return a ? 1 : 2; }'],
    ['catch', 'function f() { try { g(); } catch { return 1; } }'],
  ])('charges an unnested %s one', (_label, source) => {
    expect(scoreOne(source)).toBe(1);
  });

  it('does not charge the try, only the catch', () => {
    // Entering a `try` is not a decision — nothing branches until it throws.
    const source = 'function f() { try { g(); } finally { h(); } }';

    expect(scoreOne(source)).toBe(0);
  });
});

describe('measureCognitive — nesting, which is the whole point', () => {
  it('charges a nested if for its depth as well as itself', () => {
    // 1 + 2 + 3 = 6, against a cyclomatic score of 4.
    const source = `function f(a: number, b: number, c: number) {
      if (a) {
        if (b) {
          if (c) return 1;
        }
      }
      return 0;
    }`;

    expect(scoreOne(source)).toBe(6);
  });

  it('grades a triple nest worse than a five-arm switch, where cyclomatic does the reverse', () => {
    // This inversion is the reason the metric was added, so it is asserted
    // directly rather than left to be inferred from the two tests above.
    const flat = `function f(k: string) {
      switch (k) {
        case 'a': return 1;
        case 'b': return 2;
        case 'c': return 3;
        case 'd': return 4;
        case 'e': return 5;
        default: return 0;
      }
    }`;
    const nested = `function f(a: number, b: number, c: number) {
      if (a) { if (b) { if (c) { return 1; } } }
      return 0;
    }`;

    const cyclomatic = (s: string) => measureComplexity('t.ts', s)[0].complexity;

    expect(cyclomatic(flat)).toBeGreaterThan(cyclomatic(nested));
    expect(scoreOne(flat)).toBeLessThan(scoreOne(nested));
  });

  it('charges a nested ternary for its depth, in either arm', () => {
    // A ternary at the top level charges 1 whatever the depth rule is, so the
    // nesting has to be visible before the arithmetic can be pinned.
    expect(scoreOne('function f(a: number, b: number) { return a ? (b ? 1 : 2) : 3; }')).toBe(3);
    expect(scoreOne('function f(a: number, b: number) { return a ? 1 : (b ? 2 : 3); }')).toBe(3);
  });

  it('charges what is inside a ternary condition', () => {
    // The condition is walked, at the ternary's own depth.
    expect(scoreOne('function f(a: number, b: number) { return a && b ? 1 : 2; }')).toBe(2);
  });

  it('charges a whole switch once, however many arms it has', () => {
    const two = `function f(k: string) {
      switch (k) { case 'a': return 1; case 'b': return 2; default: return 0; }
    }`;
    const five = `function f(k: string) {
      switch (k) {
        case 'a': return 1;
        case 'b': return 2;
        case 'c': return 3;
        case 'd': return 4;
        case 'e': return 5;
        default: return 0;
      }
    }`;

    expect(scoreOne(two)).toBe(1);
    expect(scoreOne(five)).toBe(1);
  });

  it('charges a structure inside a switch arm for the switch it sits in', () => {
    // The arms are a level deeper even though they cost nothing themselves.
    const source = `function f(k: string, a: number) {
      switch (k) {
        case 'a': if (a) return 1; return 2;
        default: return 0;
      }
    }`;

    expect(scoreOne(source)).toBe(3);
  });

  it('charges a catch inside a loop for the loop it sits in', () => {
    const source = `function f(xs: number[]) {
      for (const x of xs) {
        try { g(x); } catch { h(); }
      }
    }`;

    // The loop 1, the catch 1 + 1.
    expect(scoreOne(source)).toBe(3);
  });

  it('reads a loop or switch header at the depth of the structure, not inside it', () => {
    // The body is a level deeper; the header is not, because it is read before
    // you are inside anything. Only a header carrying a structure of its own
    // can tell the difference, so that is what these are.
    expect(scoreOne('function f(a: number, b: number, c: number) { while (a ? b : c) { g(); } }')).toBe(2);
    expect(scoreOne("function f(a: number) { switch (a ? 'x' : 'y') { default: g(); } }")).toBe(2);
  });

  it('charges a loop inside a loop for its depth', () => {
    const source = `function f(rows: number[][]) {
      for (const row of rows) {
        for (const cell of row) console.log(cell);
      }
    }`;

    expect(scoreOne(source)).toBe(3);
  });
});

describe('measureCognitive — else chains stay flat', () => {
  it('charges a plain else one, with no depth penalty', () => {
    expect(scoreOne('function f(a: number) { if (a) { return 1; } else { return 2; } }')).toBe(2);
  });

  it('charges each else-if one, so a long flat chain does not read as nested', () => {
    // Head 1, then four flat arms. Nesting them would give 1+2+3+4+5 = 15 for
    // something a reader takes in as one dispatch.
    const source = `function f(a: number) {
      if (a === 1) return 1;
      else if (a === 2) return 2;
      else if (a === 3) return 3;
      else if (a === 4) return 4;
      else return 0;
    }`;

    expect(scoreOne(source)).toBe(5);
  });

  it('still charges the head of a chain for its own depth', () => {
    const source = `function f(a: number, b: number) {
      if (a) {
        if (b) return 1;
        else return 2;
      }
      return 0;
    }`;

    // Outer if 1, inner if 1+1, its else 1.
    expect(scoreOne(source)).toBe(4);
  });

  it('keeps an else-if flat even when the chain itself is nested', () => {
    // At the top level a depth penalty and a flat charge are the same number,
    // so only a nested chain says which rule is in force.
    const source = `function f(a: number, b: number) {
      if (a) {
        if (b === 1) return 1;
        else if (b === 2) return 2;
      }
      return 0;
    }`;

    // Outer if 1, inner if 1+1, the else-if a flat 1 despite sitting at depth 1.
    expect(scoreOne(source)).toBe(4);
  });

  it('reads the body of a plain else one level deeper', () => {
    const source = `function f(a: number, b: number) {
      if (a) return 1;
      else { if (b) return 2; }
      return 0;
    }`;

    // The if 1, the else 1, the if inside the else 1 + 1.
    expect(scoreOne(source)).toBe(4);
  });

  it('reads the body of an else-if one level deeper than the chain', () => {
    const source = `function f(a: number, b: number) {
      if (a === 1) return 1;
      else if (a === 2) { if (b) return 2; }
      return 0;
    }`;

    // Head 1, else-if 1, the if inside it 1 + 1.
    expect(scoreOne(source)).toBe(4);
  });
});

describe('measureCognitive — sequences of logical operators', () => {
  it('charges a run of one operator once, not once per operator', () => {
    // Cyclomatic charges two here. The run is one thing to understand.
    expect(scoreOne('function f(a: number, b: number, c: number) { return a && b && c; }')).toBe(1);
  });

  it('charges a mixture twice, because the mixture is the difficulty', () => {
    expect(scoreOne('function f(a: number, b: number, c: number) { return a || b && c; }')).toBe(2);
  });

  it('treats parentheses as breaking a run', () => {
    expect(scoreOne('function f(a: number, b: number, c: number) { return a && (b && c); }')).toBe(2);
  });

  it('charges nullish coalescing like the other logical operators', () => {
    expect(scoreOne('function f(a: number | null) { return a ?? 0; }')).toBe(1);
  });

  it('does not charge a sequence for depth', () => {
    // Only structures nest. A condition is read where it is written.
    const source = `function f(a: number, b: number, c: number) {
      if (a) { if (b && c) return 1; }
      return 0;
    }`;

    // Outer if 1, inner if 1 + 1, the && 1.
    expect(scoreOne(source)).toBe(4);
  });

  it('does not charge a non-logical binary operator', () => {
    expect(scoreOne('function f(a: number, b: number) { return a + b; }')).toBe(0);
  });
});

describe('measureCognitive — the departures from cyclomatic', () => {
  it('charges nothing for optional chaining, where cyclomatic charges one', () => {
    // The sharpest disagreement between the two scores, and deliberate: `a?.b`
    // is a branch, but not one a reader has to hold anything in mind for.
    const source = 'function f(a?: { b: number }) { return a?.b; }';

    expect(measureComplexity('t.ts', source)[0].complexity).toBe(2);
    expect(scoreOne(source)).toBe(0);
  });

  it('scores a nested function separately rather than nesting its parent', () => {
    // Campbell nests them. This repo already decided the other way for
    // cyclomatic, and two metrics describing different sets of functions in
    // one report is worse than either convention.
    const source = `function outer(xs: number[]) {
      return xs.filter((x) => (x > 0 ? true : false));
    }`;

    const scored = measureCognitive('t.ts', source);

    expect(scored).toHaveLength(2);
    expect(scored.find((f) => f.name === 'outer')!.cognitive).toBe(0);
    expect(scored.find((f) => f.name !== 'outer')!.cognitive).toBe(1);
  });

  it('does not reset depth for a callback written inside a branch', () => {
    // The callback is its own function, so its own nesting starts at zero -
    // the branch it is written inside belongs to the parent's score.
    const source = `function outer(a: number, xs: number[]) {
      if (a) {
        return xs.map((x) => (x ? 1 : 0));
      }
      return [];
    }`;

    const scored = measureCognitive('t.ts', source);

    expect(scored.find((f) => f.name === 'outer')!.cognitive).toBe(1);
    expect(scored.find((f) => f.name !== 'outer')!.cognitive).toBe(1);
  });
});

describe('measureCognitive — jumps', () => {
  it('charges a labelled break, which is a jump a reader has to follow', () => {
    const source = `function f(rows: number[][]) {
      outer: for (const row of rows) {
        for (const cell of row) { if (cell) break outer; }
      }
    }`;

    // Outer loop 1, inner loop 1+1, the if 1+2, the labelled break 1.
    expect(scoreOne(source)).toBe(7);
  });

  it('charges the jump, not the label it jumps to', () => {
    // A labelled statement also carries a `.label`, so a rule that looked at
    // the property without checking the node kind would charge the loop's
    // label instead of the break — and in the test above those two errors
    // cancel out exactly. This is the same code with a bare break, where they
    // no longer can.
    const source = `function f(rows: number[][]) {
      outer: for (const row of rows) {
        for (const cell of row) { if (cell) break; }
      }
    }`;

    // Outer loop 1, inner loop 1+1, the if 1+2. The bare break and the label
    // are both free.
    expect(scoreOne(source)).toBe(6);
  });

  it('does not charge a bare break or continue', () => {
    const source = `function f(xs: number[]) {
      for (const x of xs) { if (x) continue; }
    }`;

    // The loop 1, the if 1+1. The bare continue is free.
    expect(scoreOne(source)).toBe(3);
  });
});

describe('measureCognitive — the record it produces', () => {
  it('labels and locates functions the same way cyclomatic does', () => {
    // The two scores are printed side by side against the same function, so a
    // reader has to be able to match the rows. Sharing the discovery walk is
    // what guarantees that; this asserts it.
    const source = [
      'export const arrow = (a: number) => (a ? 1 : 2);',
      'export class C {',
      '  constructor() {}',
      '  method(a: number) { return a && 1; }',
      '}',
      'export const xs = [1].map(function () { return 1; });',
    ].join('\n');

    const cognitive = measureCognitive('src/x.ts', source);
    const cyclomatic = measureComplexity('src/x.ts', source);

    const identity = (f: FunctionRef) => `${f.file}:${f.startLine}-${f.endLine} ${f.name}`;

    expect(cognitive.map(identity)).toEqual(cyclomatic.map(identity));
  });

  it('reports nothing for a file with no functions', () => {
    expect(measureCognitive('t.ts', 'export const x = 1;')).toEqual([]);
  });

  it('returns functions in source order, parent before the one nested in it', () => {
    const source = [
      'function outer() {',
      '  return [1].map((x) => x);',
      '}',
      'function after() {}',
    ].join('\n');

    const names = measureCognitive('t.ts', source).map((f) => f.name);

    expect(names[0]).toBe('outer');
    expect(names[names.length - 1]).toBe('after');
  });

  it('carries the file through, since scores from many files are reported together', () => {
    expect(measureCognitive('src/x.ts', 'function f() {}')[0].file).toBe('src/x.ts');
  });
});
