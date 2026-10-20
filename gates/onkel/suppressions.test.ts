import { describe, it, expect } from 'vitest';
import { broadDirectives, classifySuppressions, suppressionReason, suppressionsOf, withSourceReasons } from './suppressions.ts';
import { judge } from './policy.ts';

/**
 * code-health/31: every suppression the gate lets through reaches the owner with its
 * reason. Stryker cannot supply that reason for the repo's own convention — it
 * reads one only after a colon, and `/onkel` prescribes an em-dash — so it is
 * read from the source, here.
 */

describe('suppressionReason', () => {
  it('reads the reason after an em-dash on the comment above the mutant', () => {
    const src = [
      'const a = 1;',
      '// Stryker disable next-line ConditionalExpression — equivalent: both branches return 0',
      'return x ? 0 : 0;',
    ].join('\n');
    expect(suppressionReason(src, 3)).toEqual({ commentLine: 2, reason: 'equivalent: both branches return 0', mutators: ['conditionalexpression'] });
  });

  it('reads a colon reason and joins the comment lines that continue it', () => {
    const src = [
      '// Stryker disable next-line ArrayDeclaration: equivalent under the unit mock;',
      "//   atomicity is db.batch's",
      'await db.batch([a, b]);',
    ].join('\n');
    expect(suppressionReason(src, 3)).toEqual({ commentLine: 1, reason: "equivalent under the unit mock; atomicity is db.batch's", mutators: ['arraydeclaration'] });
  });

  it('returns a null reason when the directive carries none', () => {
    expect(suppressionReason('// Stryker disable next-line StringLiteral\nconst s = "x";', 2)).toEqual({ commentLine: 1, reason: null, mutators: ['stringliteral'] });
  });

  it('finds no suppression when a line of code sits between the directive and the mutant', () => {
    const src = ['// Stryker disable next-line X — r', 'const a = 1;', 'const b = 2;'].join('\n');
    expect(suppressionReason(src, 3)).toBeNull();
  });

  it('reads an indented comment block inside a function body', () => {
    const src = ['function f() {', '    // Stryker disable next-line EqualityOperator — equal keys give the same key', '    return a > b ? a : b;', '}'].join('\n');
    expect(suppressionReason(src, 3)).toEqual({ commentLine: 2, reason: 'equal keys give the same key', mutators: ['equalityoperator'] });
  });

  it('stops the reason at the mutant line: a comment below the code is not part of it', () => {
    const src = ['// Stryker disable next-line X — equivalent', 'return a;', '// a note about the next function'].join('\n');
    expect(suppressionReason(src, 2)).toEqual({ commentLine: 1, reason: 'equivalent', mutators: ['x'] });
  });

  it('does not take a trailing comment on a code line for a directive block', () => {
    expect(suppressionReason('const a = 1; // Stryker disable next-line X — r\nreturn a;', 2)).toBeNull();
  });

  it('gives no reason for a separator with nothing after it, or reason lines with no separator', () => {
    expect(suppressionReason('// Stryker disable next-line X —\nreturn a;', 2)).toEqual({ commentLine: 1, reason: null, mutators: ['x'] });
    expect(suppressionReason('// Stryker disable next-line X\n// equivalent\nreturn a;', 3)).toEqual({ commentLine: 1, reason: null, mutators: ['x'] });
  });

  it('reads every mutator a directive names, as Stryker does: comma-separated, any case', () => {
    const src = '// Stryker disable next-line StringLiteral, ConditionalExpression: same text\nconst s = a ? "x" : "x";';
    expect(suppressionReason(src, 2)?.mutators).toEqual(['stringliteral', 'conditionalexpression']);
  });

  it('names no mutator for a comment that only mentions a directive: Stryker reads none there', () => {
    expect(suppressionReason('// note: Stryker disable next-line X — r\nreturn a;', 2)).toEqual({ commentLine: 1, reason: 'r', mutators: [] });
  });

  it('finds no suppression on the first line of a file, or under a plain comment', () => {
    expect(suppressionReason('const a = 1;', 1)).toBeNull();
    expect(suppressionReason('// just a note\nconst a = 1;', 2)).toBeNull();
  });
});

describe('suppressionsOf', () => {
  const SRC = 'const a = 1;\n// Stryker disable next-line X — equivalent\nreturn a;';
  const mutant = (over = {}) => ({ file: 'src/a.ts', line: 3, mutator: 'X', status: 'Ignored', ...over });

  it('locates every Ignored mutant and reads its reason from the source', () => {
    expect(suppressionsOf([mutant(), mutant({ status: 'Killed', line: 1 })], () => SRC)).toEqual([
      { file: 'src/a.ts', line: 3, mutator: 'X', commentLine: 2, reason: 'equivalent' },
    ]);
  });

  it('leaves out a broad suppression: it is a failure, not a suppression let through (decision #28)', () => {
    expect(suppressionsOf([mutant({ broad: true })], () => SRC)).toEqual([]);
  });

  it('falls back to Stryker’s own reason when no comment sits above, and to none when the file is unread', () => {
    expect(suppressionsOf([mutant({ line: 1, ignoreReason: 'excluded by config' })], () => SRC)).toEqual([
      { file: 'src/a.ts', line: 1, mutator: 'X', commentLine: 1, reason: 'excluded by config' },
    ]);
    expect(suppressionsOf([mutant()], () => undefined)).toEqual([
      { file: 'src/a.ts', line: 3, mutator: 'X', commentLine: 3, reason: null },
    ]);
  });
});

describe('classifySuppressions', () => {
  const a = { file: 'src/a.ts', line: 10, mutator: 'X', commentLine: 9, reason: 'r1' };
  const b = { file: 'src/a.ts', line: 40, mutator: 'Y', commentLine: 39, reason: 'r2' };

  it('lists a suppression whose comment line is in the diff as new, the rest as already there', () => {
    expect(classifySuppressions([a, b], [{ file: 'src/a.ts', ranges: [[5, 12]] }])).toEqual({ new: [a], existing: [b] });
  });

  it('counts a comment on either edge of a changed range as new, and one in another file as not', () => {
    const elsewhere = { ...a, file: 'src/b.ts' };
    expect(classifySuppressions([a, b, elsewhere], [{ file: 'src/a.ts', ranges: [[9, 9], [39, 40]] }])).toEqual({ new: [a, b], existing: [elsewhere] });
    expect(classifySuppressions([a], [{ file: 'src/a.ts', ranges: [[10, 12]] }])).toEqual({ new: [], existing: [a] });
  });

  it('matches the suppression against the file it is in, among several changed files', () => {
    const changed = [
      { file: 'src/z.ts', ranges: [[1, 100]] as [number, number][] },
      { file: 'src/a.ts', ranges: [[1, 2], [9, 9]] as [number, number][] },
    ];
    expect(classifySuppressions([a, b], changed)).toEqual({ new: [a], existing: [b] });
  });

  it('lists everything unsplit when there is no diff to compare', () => {
    expect(classifySuppressions([a], null)).toEqual({ unsplit: [a] });
  });
});

/**
 * code-health/33: the verdict judges "explained" on the reason in the source, not on
 * Stryker's report, which carries its placeholder "Ignored using a comment" for every
 * em-dash suppression and for every suppression with no reason at all.
 */
describe('withSourceReasons + judge (issue 33)', () => {
  const STRYKER_DEFAULT = 'Ignored using a comment';
  const ignored = (line: number) => ({ file: 'src/a.ts', line, mutator: 'EqualityOperator', status: 'Ignored', ignoreReason: STRYKER_DEFAULT });
  const verdictFor = (source: string) => {
    const mutants = withSourceReasons([ignored(2)], () => source);
    return judge({ crap: [], mutants });
  };

  it('fails a suppression with no reason, em-dash style comment', () => {
    const v = verdictFor('// Stryker disable next-line EqualityOperator\nif (a === b) x();\n');
    expect(v.verdict).toBe('escalate');
    expect(v.failures[0]?.kind).toBe('unexplained-suppression');
  });

  it('fails a suppression with no reason, colon style comment', () => {
    expect(verdictFor('// Stryker disable next-line EqualityOperator:\nif (a === b) x();\n').verdict).toBe('escalate');
  });

  it('passes a suppression with a reason after an em-dash, the convention /onkel prescribes', () => {
    const v = verdictFor('// Stryker disable next-line EqualityOperator — both sides are the same id\nif (a === b) x();\n');
    expect(v.verdict).toBe('pass');
    expect(v.suppressed).toBe(1);
  });

  it('passes a suppression with a reason after a colon', () => {
    expect(verdictFor('// Stryker disable next-line EqualityOperator: same id\nif (a === b) x();\n').verdict).toBe('pass');
  });

  it("treats Stryker's placeholder as no reason when the comment cannot be found in the source", () => {
    const mutants = withSourceReasons([ignored(2)], () => undefined);
    expect(judge({ crap: [], mutants }).verdict).toBe('escalate');
  });

  it('fails a config-level ignore as a broad suppression, whatever reason the config gives (decision #28)', () => {
    const mutants = withSourceReasons([{ ...ignored(2), ignoreReason: 'excluded in stryker config: generated file' }], () => 'x\ny\n');
    const v = judge({ crap: [], mutants });
    expect(v.verdict).toBe('escalate');
    expect(v.failures.map((f) => f.kind)).toEqual(['broad-suppression']);
    expect(v.suppressed).toBe(0);
  });

  it('fails a mutant ignored by a file- or block-level directive above it as a broad suppression', () => {
    const source = '// Stryker disable EqualityOperator: whole file\nif (a === b) x();\n';
    expect(withSourceReasons([ignored(2)], () => source)).toEqual([{ ...ignored(2), broad: true }]);
  });

  it('fails a line-level directive that names `all`, or another mutator, as a broad suppression', () => {
    for (const directive of ['// Stryker disable next-line all: everything', '// Stryker disable next-line StringLiteral: not this one']) {
      const mutants = withSourceReasons([ignored(2)], () => `${directive}\nif (a === b) x();\n`);
      expect(judge({ crap: [], mutants }).failures.map((f) => f.kind)).toEqual(['broad-suppression']);
    }
  });

  it('accepts a line-level directive naming the mutator in another case, as Stryker matches it', () => {
    const mutants = withSourceReasons([ignored(2)], () => '// Stryker disable next-line equalityOperator: same id\nif (a === b) x();\n');
    expect(mutants).toEqual([{ ...ignored(2), ignoreReason: 'same id' }]);
  });

  it('leaves non-ignored mutants untouched', () => {
    const killed = { file: 'src/a.ts', line: 1, mutator: 'X', status: 'Killed' };
    expect(withSourceReasons([killed], () => '')).toEqual([killed]);
  });

  it('gives no reason to a mutant that was not ignored, even under a suppression comment', () => {
    const survived = { file: 'src/a.ts', line: 2, mutator: 'EqualityOperator', status: 'Survived' };
    const source = '// Stryker disable next-line EqualityOperator: same id\nif (a === b) x();\n';
    expect(withSourceReasons([survived], () => source)).toStrictEqual([survived]);
  });
});

/** decision #28: only a line-level directive naming its mutators is accepted; any broader one in a graded file fails. */
describe('broadDirectives', () => {
  const at = (source: string, changed: Parameters<typeof broadDirectives>[1] = null) => broadDirectives([{ file: 'src/a.ts', source }], changed);

  it('names a file-level, block-level or `all` directive with its file and line', () => {
    const source = [
      '// Stryker disable all',
      'const a = 1;',
      '  // Stryker disable StringLiteral: block',
      '/* Stryker disable next-line all: everything */',
      'const b = 2; // Stryker disable ConditionalExpression',
    ].join('\n');
    expect(at(source)).toEqual([
      { file: 'src/a.ts', line: 1, text: 'Stryker disable all' },
      { file: 'src/a.ts', line: 3, text: 'Stryker disable StringLiteral' },
      { file: 'src/a.ts', line: 4, text: 'Stryker disable next-line all' },
      { file: 'src/a.ts', line: 5, text: 'Stryker disable ConditionalExpression' },
    ]);
  });

  it('accepts a line-level directive naming its mutators, a restore, and text that only mentions a directive', () => {
    const source = [
      '// Stryker disable next-line StringLiteral, ConditionalExpression: equivalent',
      '// Stryker restore all',
      ' * A `Stryker disable all` in prose is no directive.',
      '/** Stryker disable all — a doc comment Stryker does not read as one */',
      '//  Stryker disable all (two spaces: Stryker does not read it either)',
    ].join('\n');
    expect(at(source)).toEqual([]);
  });

  it('reads Stryker’s own grammar: a list that stops at the hyphen of a misspelt next-line is a broad disable', () => {
    expect(at('// Stryker disable next-lines X: r')).toEqual([{ file: 'src/a.ts', line: 1, text: 'Stryker disable next' }]);
  });

  it('looks only in files the change touched, and in every named file when there is no diff', () => {
    const graded = [
      { file: 'src/a.ts', source: '// Stryker disable all' },
      { file: 'src/b.ts', source: 'x;\n// Stryker disable all' },
    ];
    const changed: Parameters<typeof broadDirectives>[1] = [
      { file: 'src/c.ts', ranges: [[1, 1]] },
      { file: 'src/b.ts', ranges: [[1, 1]] },
    ];
    expect(broadDirectives(graded, changed)).toEqual([{ file: 'src/b.ts', line: 2, text: 'Stryker disable all' }]);
    expect(broadDirectives(graded, null).map((d) => d.file)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('fails the run on each one, beside a CRAP failure that skipped mutation', () => {
    const v = judge({
      crap: [{ name: 'f', file: 'src/a.ts', startLine: 1, endLine: 2, crap: 9 }],
      mutants: [],
      mutationSkipped: true,
      broadDirectives: at('// Stryker disable all'),
    });
    expect(v.failures.map((f) => [f.kind, f.file, f.line])).toEqual([
      ['crap', 'src/a.ts', 1],
      ['broad-suppression', 'src/a.ts', 1],
    ]);
    expect(v.failures[1]?.detail).toBe(
      'Stryker disable all: broader than one line; only a line-level "disable next-line <mutator>: <reason>" is accepted',
    );
  });
});
