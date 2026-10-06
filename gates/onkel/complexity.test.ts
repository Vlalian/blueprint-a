import { describe, it, expect } from 'vitest';
import { measureComplexity } from './complexity.ts';

/**
 * Cyclomatic complexity, counted from the TypeScript AST.
 *
 * These rules are the specification. At the ceiling of 6 that `/onkel` Mode A
 * enforces they decide pass and fail on their own — at a ceiling of 30 an
 * off-by-one hardly matters, at 6 it is the difference between shipping and
 * escalating. So each construct gets a test saying what it costs.
 */

/** Complexity of the single function in `source`. */
function scoreOne(source: string): number {
  const [only] = measureComplexity('t.ts', source);
  return only.complexity;
}

describe('measureComplexity', () => {
  it('scores a branchless function 1', () => {
    expect(scoreOne('function f() { return 1; }')).toBe(1);
  });

  it.each([
    ['if', 'function f(a: number) { if (a) return 1; return 2; }'],
    ['for', 'function f(a: number[]) { for (const x of a) console.log(x); }'],
    ['while', 'function f(a: number) { while (a) a--; }'],
    ['ternary', 'function f(a: number) { return a ? 1 : 2; }'],
    ['logical and', 'function f(a: number, b: number) { return a && b; }'],
    ['logical or', 'function f(a: number, b: number) { return a || b; }'],
    ['nullish coalescing', 'function f(a: number | null) { return a ?? 0; }'],
    ['catch', 'function f() { try { g(); } catch { return 1; } }'],
    ['optional call', 'function f(a?: () => void) { a?.(); }'],
  ])('counts a %s as one decision', (_label, source) => {
    expect(scoreOne(source)).toBe(2);
  });

  it('counts each case of a switch, but not the default', () => {
    // `default` is the fall-through, not a decision — taking it is what
    // happens when every decision above said no.
    const source = `function f(a: string) {
      switch (a) {
        case 'x': return 1;
        case 'y': return 2;
        default: return 3;
      }
    }`;

    expect(scoreOne(source)).toBe(3);
  });

  it('does not charge an else, which is the same decision', () => {
    expect(scoreOne('function f(a: number) { if (a) { return 1; } else { return 2; } }')).toBe(2);
  });

  it('adds up nested decisions in the same function', () => {
    const source = `function f(a: number, b: number) {
      if (a) {
        if (b) return 1;
      }
      return a || b;
    }`;

    expect(scoreOne(source)).toBe(4);
  });

  it('scores a nested function separately rather than charging its parent', () => {
    // Otherwise a function whose only sin is holding a callback reads as
    // complex, and extracting the callback would "fix" a score without
    // changing anything a reader cares about.
    const source = `function outer(xs: number[]) {
      return xs.filter((x) => (x > 0 ? true : false));
    }`;

    const scored = measureComplexity('t.ts', source);

    expect(scored).toHaveLength(2);
    expect(scored.find((f) => f.name === 'outer')!.complexity).toBe(1);
    expect(scored.find((f) => f.name !== 'outer')!.complexity).toBe(2);
  });

  it('finds arrow functions, methods and class members, not just declarations', () => {
    const source = `
      export const arrow = (a: number) => (a ? 1 : 2);
      export class C {
        method(a: number) { return a && 1; }
      }
      export const obj = { prop(a: number) { return a || 1; } };
    `;

    const names = measureComplexity('t.ts', source).map((f) => f.name);

    expect(names).toContain('arrow');
    expect(names).toContain('method');
    expect(names).toContain('prop');
  });

  it('reports the line range, so coverage can be attributed to the function', () => {
    const source = ['function f() {', '  return 1;', '}'].join('\n');

    const [only] = measureComplexity('t.ts', source);

    expect(only.startLine).toBe(1);
    expect(only.endLine).toBe(3);
  });

  it('names a constructor, and an anonymous function by its line', () => {
    // The name is how a failure report points at the function. "(anonymous)"
    // with no line would send a reader hunting through the file.
    const source = ['class C {', '  constructor() {}', '}', 'export const xs = [1].map(function () { return 1; });'].join('\n');

    const names = measureComplexity('t.ts', source).map((f) => f.name);

    expect(names).toContain('constructor');
    expect(names).toContain('(anonymous):4');
  });

  it('returns functions in source order', () => {
    // The report reads top to bottom against the file.
    const source = ['function a() {}', 'function b() {}', 'function c() {}'].join('\n');

    expect(measureComplexity('t.ts', source).map((f) => f.name)).toEqual(['a', 'b', 'c']);
  });

  it('carries the file through, since scores from many files are reported together', () => {
    expect(measureComplexity('src/x.ts', 'function f() {}')[0].file).toBe('src/x.ts');
  });

  it('counts an optional property access, not just an optional call', () => {
    expect(scoreOne('function f(a?: { b: number }) { return a?.b; }')).toBe(2);
  });

  it('does not count an ordinary call or access', () => {
    expect(scoreOne('function f(a: { b: () => number }) { return a.b(); }')).toBe(1);
  });

  it('counts an optional element access, and not an ordinary one', () => {
    // All three optional-capable kinds branch the same way, and all three are
    // free without the `?.` — testing one would leave the other two guessing.
    expect(scoreOne('function f(a?: number[]) { return a?.[0]; }')).toBe(2);
    expect(scoreOne('function f(a: number[]) { return a[0]; }')).toBe(1);
  });

  it('does not count a non-branching binary operator', () => {
    expect(scoreOne('function f(a: number, b: number) { return a + b; }')).toBe(1);
  });

  it('counts a do-while and a for-in', () => {
    expect(scoreOne('function f(a: number) { do { a--; } while (a); }')).toBe(2);
    expect(scoreOne('function f(o: object) { for (const k in o) console.log(k); }')).toBe(2);
  });

  it('reports nothing for a file with no functions', () => {
    expect(measureComplexity('t.ts', 'export const x = 1;')).toEqual([]);
  });
});

describe('measureComplexity — reporting order', () => {
  it('reports a parent before the function nested inside it', () => {
    // The report reads top to bottom against the file. The old walk recorded a
    // nested function before its parent and needed a sort to fix that;
    // `eachFunction` descends instead, so the order is a property of the walk
    // and this is what holds it there.
    const source = [
      'function outer() {',
      '  return [1].map((x) => x);',
      '}',
      'function after() {}',
    ].join('\n');

    const names = measureComplexity('t.ts', source).map((f) => f.name);

    expect(names[0]).toBe('outer');
    expect(names[names.length - 1]).toBe('after');
  });

  it('holds the order for a function in a parameter default, not just one in a body', () => {
    // The case the order depends on and the test above does not reach: a
    // parameter default is walked *before* the body, so if any position could
    // hand back a nested function ahead of a later sibling, this is it. With
    // no sort left to correct it, the walk has to be right on its own.
    const source = ['function outer(cb = () => 1) {}', 'function after() {}'].join('\n');

    const lines = measureComplexity('t.ts', source).map((f) => f.startLine);

    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(measureComplexity('t.ts', source)[2].name).toBe('after');
  });
});
