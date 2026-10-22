import { describe, expect, it } from 'vitest';
import type { FunctionLines, FunctionScore, Mutant, TestStrengthAdapter } from './contract.ts';
import { CRAP_CEILING, crapGate, crapScore, mutationGate, testStrengthGate } from './gate.ts';

const fn = (name: string, complexity: number, startLine = 1, file = 'src/a.ts'): FunctionScore => ({ file, name, startLine, endLine: startLine + 5, complexity });
const lines = (score: FunctionScore, total: number, covered: number): FunctionLines => ({ ...score, complexity: undefined, lines: total, covered }) as unknown as FunctionLines;
const SUPPRESSED = 'export const a = 1;\n// Stryker disable next-line ConditionalExpression: equivalent, both branches return 1\nexport const b = x ? 1 : 1;\n';
const NO_SOURCE = () => undefined;
const mutant = (status: string, line = 3): Mutant => ({ file: 'src/a.ts', line, mutator: 'ConditionalExpression', status });

function adapter(parts: Partial<{ scores: FunctionScore[]; lines: FunctionLines[]; mutants: Mutant[] }>, seen: string[][] = []): TestStrengthAdapter {
  return {
    complexity: (paths) => (seen.push(['complexity', ...paths]), parts.scores ?? []),
    coverage: (paths) => (seen.push(['coverage', ...paths]), parts.lines ?? []),
    mutate: (paths) => (seen.push(['mutate', ...paths]), parts.mutants ?? []),
  };
}

describe('crapScore', () => {
  it('is the complexity for a fully covered function', () => {
    expect(crapScore(4, 10, 10)).toBe(4);
  });

  it('is complexity squared plus complexity for an untested one', () => {
    expect(crapScore(3, 8, 0)).toBe(12);
  });

  it('punishes missing coverage cubically', () => {
    expect(crapScore(4, 2, 1)).toBe(16 * 0.125 + 4);
  });

  it('reads a function with no lines of its own as covered', () => {
    expect(crapScore(5, 0, 0)).toBe(5);
  });
});

describe('crapGate', () => {
  it('matches coverage to the correct function when two start on the same line', () => {
    const a = { ...fn('a', 3), startColumn: 0, endColumn: 20 };
    const b = { ...fn('b', 3), startColumn: 21, endColumn: 45 };
    expect(crapGate(['src/a.ts'], adapter({ scores: [a, b], lines: [lines(a, 1, 1), lines(b, 1, 0)] }))).toMatchObject({ pass: false, over: [{ name: 'b', crap: 12 }] });
  });
  it('has the ceiling 6', () => {
    expect(CRAP_CEILING).toBe(6);
  });

  it('passes covered functions at the ceiling and asks the adapter about the named paths', () => {
    const a = fn('a', 6);
    const seen: string[][] = [];
    const result = crapGate(['src/a.ts'], adapter({ scores: [a], lines: [lines(a, 4, 4)] }, seen));
    expect(result).toEqual({ gate: 'crap', pass: true, ceiling: 6, functions: 1, over: [] });
    expect(seen).toEqual([
      ['complexity', 'src/a.ts'],
      ['coverage', 'src/a.ts'],
    ]);
  });

  it('fails a function over the ceiling and names it with its score and coverage', () => {
    const a = fn('a', 3);
    const result = crapGate(['src/a.ts'], adapter({ scores: [a], lines: [lines(a, 4, 0)] }));
    expect(result).toMatchObject({ pass: false, over: [{ ...a, coverage: 0, crap: 12 }] });
  });

  it('scores a function the coverage never reached as untested', () => {
    expect(crapGate(['src/a.ts'], adapter({ scores: [fn('a', 3)], lines: [] }))).toMatchObject({ pass: false, over: [{ coverage: 0, crap: 12 }] });
  });

  it("matches a function's coverage by file and start line, never another function's", () => {
    const a = fn('a', 3);
    const later = fn('a', 3, 40);
    const elsewhere = fn('a', 3, 1, 'src/b.ts');
    expect(crapGate(['src/a.ts'], adapter({ scores: [a], lines: [lines(later, 1, 1), lines(elsewhere, 1, 1)] }))).toMatchObject({ pass: false, over: [{ crap: 12 }] });
    expect(crapGate(['src/a.ts'], adapter({ scores: [later], lines: [lines(a, 1, 0), lines(later, 1, 1)] }))).toMatchObject({ pass: true });
  });

  it('reports the coverage it scored: the share of lines run, all of it for a function with no lines', () => {
    const a = fn('a', 9);
    const b = fn('b', 9, 20);
    const result = crapGate(['src/a.ts'], adapter({ scores: [a, b], lines: [lines(a, 4, 1), lines(b, 0, 0)] }));
    expect(result).toMatchObject({ over: [{ name: 'a', coverage: 0.25 }, { name: 'b', coverage: 1 }] });
  });

  it('takes another ceiling when given one', () => {
    const a = fn('a', 7);
    expect(crapGate(['src/a.ts'], adapter({ scores: [a], lines: [lines(a, 1, 1)] }), 8)).toMatchObject({ pass: true, ceiling: 8 });
  });
});

describe('mutationGate', () => {
  it('passes when every mutant is killed, timed out or did not compile', () => {
    const seen: string[][] = [];
    const result = mutationGate(['src/a.ts'], adapter({ mutants: [mutant('Killed'), mutant('Timeout'), mutant('CompileError')] }, seen), NO_SOURCE);
    expect(result).toEqual({ gate: 'mutation', pass: true, mutants: 3, standing: [], ignored: [], unverified: [] });
    expect(seen).toEqual([['mutate', 'src/a.ts']]);
  });

  it('fails on a survivor or a mutant no test reaches, naming each', () => {
    const result = mutationGate(['src/a.ts'], adapter({ mutants: [mutant('Killed'), mutant('Survived', 4), mutant('NoCoverage', 5), mutant('RuntimeError', 6)] }), NO_SOURCE);
    expect(result).toMatchObject({ pass: false, mutants: 4, standing: [mutant('Survived', 4), mutant('NoCoverage', 5), mutant('RuntimeError', 6)] });
  });

  it('lets an ignored mutant through under a line-level directive naming its mutator with a reason, and lists it', () => {
    const source = (file: string) => (file === 'src/a.ts' ? SUPPRESSED : undefined);
    expect(mutationGate(['src/a.ts'], adapter({ mutants: [mutant('Ignored')] }), source)).toMatchObject({ pass: true, ignored: [mutant('Ignored')], unverified: [] });
  });

  it.each([
    ['no directive at all (a config-level ignore)', 'export const a = 1;\n\nexport const b = x ? 1 : 2;\n'],
    ['a directive without a reason', 'export const a = 1;\n// Stryker disable next-line ConditionalExpression\nexport const b = x ? 1 : 2;\n'],
    ['a directive naming another mutator', 'export const a = 1;\n// Stryker disable next-line StringLiteral: equivalent\nexport const b = x ? 1 : 2;\n'],
    ['a directive for all mutators', 'export const a = 1;\n// Stryker disable next-line all: equivalent\nexport const b = x ? 1 : 2;\n'],
    ['a file-level directive', '// Stryker disable all: legacy\nexport const a = 1;\nexport const b = x ? 1 : 2;\n'],
  ])('fails an ignored mutant under %s (ticket 74, finding 5)', (_label, text) => {
    const result = mutationGate(['src/a.ts'], adapter({ mutants: [mutant('Ignored'), mutant('Killed', 1)] }), () => text);
    expect(result).toMatchObject({ pass: false, ignored: [], unverified: [mutant('Ignored')] });
  });

  it('fails an ignored mutant whose file cannot be read: an unread suppression is unverified', () => {
    expect(mutationGate(['src/a.ts'], adapter({ mutants: [mutant('Ignored')] }), () => undefined)).toMatchObject({ pass: false, unverified: [mutant('Ignored')] });
  });

  it.each(['all', 'all, ConditionalExpression', 'ConditionalExpression, all'])(
    'rejects a broad mutator list %s even when it names the ignored mutant (ticket 74 review)',
    (mutators) => {
      const source = `export const a = 1;\n// Stryker disable next-line ${mutators}: broad reason\nexport const b = x ? 1 : 2;\n`;
      expect(mutationGate(['src/a.ts'], adapter({ mutants: [mutant('Ignored')] }), () => source))
        .toMatchObject({ pass: false, ignored: [], unverified: [mutant('Ignored')] });
    },
  );

  it('fails when nothing was mutated: a gate that measured nothing must not pass', () => {
    expect(mutationGate(['src/a.ts'], adapter({ mutants: [] }), NO_SOURCE)).toEqual({
      gate: 'mutation',
      pass: false,
      mutants: 0,
      standing: [],
      ignored: [],
      unverified: [],
      reason: 'nothing was mutated; name source files that hold code',
    });
  });
});

describe('testStrengthGate', () => {
  const made: unknown[] = [];
  const factory = (parts: Parameters<typeof adapter>[0]) => (options: unknown) => (made.push(options), adapter(parts));

  it('runs the crap gate through the adapter made for the named runner, cwd and coverage file', () => {
    made.length = 0;
    const a = fn('a', 2);
    const result = testStrengthGate(['crap', '--runner', 'jest', '--cwd', 'w', '--coverage', 'c.json', 'src/a.ts'], factory({ scores: [a], lines: [lines(a, 1, 1)] }), NO_SOURCE);
    expect(result).toMatchObject({ gate: 'crap', pass: true });
    expect(made).toEqual([{ runner: 'jest', cwd: 'w', coverageFile: 'c.json' }]);
  });

  it('runs the mutation gate, with vitest and the current folder by default', () => {
    made.length = 0;
    expect(testStrengthGate(['mutation', 'src/a.ts'], factory({ mutants: [mutant('Survived')] }), NO_SOURCE)).toMatchObject({ gate: 'mutation', pass: false });
    expect(made).toEqual([{ runner: 'vitest', cwd: '.', coverageFile: undefined }]);
  });

  it("reads an ignored mutant's source from the project folder", () => {
    const read: string[][] = [];
    const readSource = (cwd: string, file: string) => (read.push([cwd, file]), SUPPRESSED);
    expect(testStrengthGate(['mutation', '--cwd', 'w', 'src/a.ts'], factory({ mutants: [mutant('Ignored')] }), readSource)).toMatchObject({ pass: true });
    expect(read).toEqual([['w', 'src/a.ts']]);
  });

  it('hands the dotnet runner to the adapter factory like any other', () => {
    made.length = 0;
    testStrengthGate(['mutation', '--runner', 'dotnet', '--cwd', 'w', 'src/A.cs'], factory({ mutants: [mutant('Killed')] }), NO_SOURCE);
    expect(made).toEqual([{ runner: 'dotnet', cwd: 'w', coverageFile: undefined }]);
  });

  it('takes a ceiling for the crap gate', () => {
    const a = fn('a', 7);
    expect(testStrengthGate(['crap', '--ceiling', '7', 'src/a.ts'], factory({ scores: [a], lines: [lines(a, 1, 1)] }), NO_SOURCE)).toMatchObject({ pass: true, ceiling: 7 });
  });

  it('refuses an unknown gate, an unknown runner, a bad ceiling or no paths', () => {
    const usage = /usage: test-strength <crap\|mutation> \[--runner vitest\|jest\|karma\|dotnet\]/;
    expect(() => testStrengthGate(['speed', 'src/a.ts'], factory({}), NO_SOURCE)).toThrow(usage);
    expect(() => testStrengthGate(['crap', '--runner', 'mocha', 'src/a.ts'], factory({}), NO_SOURCE)).toThrow(usage);
    expect(() => testStrengthGate(['crap'], factory({}), NO_SOURCE)).toThrow(usage);
    expect(() => testStrengthGate([], factory({}), NO_SOURCE)).toThrow(usage);
    expect(() => testStrengthGate(['crap', '--ceiling', 'six', 'src/a.ts'], factory({}), NO_SOURCE)).toThrow(usage);
  });
});
