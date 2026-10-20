import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import { measureComplexity, rangeOf } from './complexity.ts';
import {
  changedRanges,
  emptyMeansMissed,
  mutateEntries,
  mutatedFiles,
  strykerMissedFiles,
  parseArgs,
  splitByChange,
  untouchedFiles,
  untrackedChange,
  untrustedLines,
  widenToFunctions,
  type ChangedFile,
  type LineRange,
} from './scope.ts';

/**
 * The gate grades what a change touched, and "touched" is read off
 * `git diff -U0 <base>`. These fixtures are real `-U0` output, captured from a
 * scratch repository, so the parser is held to what git actually prints.
 */

const MODIFIED = [
  'diff --git a/m.ts b/m.ts',
  'index 0fdf397..fd94124 100644',
  '--- a/m.ts',
  '+++ b/m.ts',
  '@@ -2 +2 @@ a',
  '-b',
  '+B',
  '@@ -4 +3,0 @@ c',
  '-d',
  '@@ -6,0 +6,2 @@ f',
  '+new1',
  '+new2',
].join('\n');

const ADDED = [
  'diff --git a/added.ts b/added.ts',
  'new file mode 100644',
  'index 0000000..8ba3a16',
  '--- /dev/null',
  '+++ b/added.ts',
  '@@ -0,0 +1,3 @@',
  '+n',
  '+o',
  '+p',
].join('\n');

const DELETED = [
  'diff --git a/gone.ts b/gone.ts',
  'deleted file mode 100644',
  'index b77b4eb..0000000',
  '--- a/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-x',
  '-y',
].join('\n');

const RENAMED = [
  'diff --git a/old.ts b/renamed.ts',
  'similarity index 70%',
  'rename from old.ts',
  'rename to renamed.ts',
  'index 535d2b0..5be12ea 100644',
  '--- a/old.ts',
  '+++ b/renamed.ts',
  '@@ -8 +8 @@',
  '-8',
  '+EIGHT',
].join('\n');

const LOCALE = [
  'diff --git a/src/app/[locale]/p.ts b/src/app/[locale]/p.ts',
  'index e563bc2..4b1287e 100644',
  '--- a/src/app/[locale]/p.ts',
  '+++ b/src/app/[locale]/p.ts',
  '@@ -2 +2 @@ p',
  '-q',
  '+Q',
].join('\n');

describe('changedRanges — the lines a change added or modified', () => {
  it('reads nothing from an empty diff', () => {
    expect(changedRanges('')).toEqual([]);
  });

  it('takes a modified line from the new side of the hunk', () => {
    expect(changedRanges(LOCALE)).toEqual([{ file: 'src/app/[locale]/p.ts', ranges: [[2, 2]] }]);
  });

  it('keeps every hunk of a file, and a pure deletion adds no range', () => {
    // `-4 +3,0` removed line 4 and added nothing: there is no new line for a
    // test to be checking, so there is nothing to grade.
    expect(changedRanges(MODIFIED)).toEqual([
      {
        file: 'm.ts',
        ranges: [
          [2, 2],
          [6, 7],
        ],
      },
    ]);
  });

  it('treats a new file as changed from its first line to its last', () => {
    expect(changedRanges(ADDED)).toEqual([{ file: 'added.ts', ranges: [[1, 3]] }]);
  });

  it('leaves a deleted file out entirely', () => {
    expect(changedRanges(DELETED)).toEqual([]);
  });

  it('keeps a file whose diff only deletes lines, with nothing to grade (decision #45)', () => {
    const deletionOnly = ['diff --git a/d.ts b/d.ts', '--- a/d.ts', '+++ b/d.ts', '@@ -4 +3,0 @@ c', '-d'].join('\n');
    expect(changedRanges(deletionOnly)).toEqual([{ file: 'd.ts', ranges: [] }]);
  });

  it('keeps a deletion-only file beside a deleted one, and leaves the deleted one out', () => {
    const deletionOnly = ['diff --git a/d.ts b/d.ts', '--- a/d.ts', '+++ b/d.ts', '@@ -4,2 +3,0 @@', '-d', '-e'].join('\n');
    expect(changedRanges(`${DELETED}\n${deletionOnly}\n${ADDED}`)).toEqual([
      { file: 'd.ts', ranges: [] },
      { file: 'added.ts', ranges: [[1, 3]] },
    ]);
  });

  it('leaves out a section with a hunk but no new-side header', () => {
    expect(changedRanges(['diff --git a/d.ts b/d.ts', '@@ -4 +4 @@', '+d'].join('\n'))).toEqual([]);
  });

  it('leaves out a section with a new-side header but no hunk', () => {
    const modeOnly = ['diff --git a/d.ts b/d.ts', 'old mode 100644', 'new mode 100755', '+++ b/d.ts'].join('\n');
    expect(changedRanges(modeOnly)).toEqual([]);
  });

  it('files a renamed file under its new name', () => {
    expect(changedRanges(RENAMED)).toEqual([{ file: 'renamed.ts', ranges: [[8, 8]] }]);
  });

  it('leaves out a rename that changed no content', () => {
    const pureRename = [
      'diff --git a/a.ts b/b.ts',
      'similarity index 100%',
      'rename from a.ts',
      'rename to b.ts',
    ].join('\n');

    expect(changedRanges(pureRename)).toEqual([]);
  });

  it('reads several files in one diff, each under its own name', () => {
    expect(changedRanges([ADDED, DELETED, MODIFIED, RENAMED].join('\n'))).toEqual([
      { file: 'added.ts', ranges: [[1, 3]] },
      {
        file: 'm.ts',
        ranges: [
          [2, 2],
          [6, 7],
        ],
      },
      { file: 'renamed.ts', ranges: [[8, 8]] },
    ]);
  });

  it('does not mistake an added line that begins "++ " for a file header', () => {
    // Inside a hunk, an added line reading `++ b/x.ts` is printed as
    // `+++ b/x.ts`. Taken as a header, it would move every later range onto
    // a file that was never in the diff.
    const tricky = [
      'diff --git a/t.ts b/t.ts',
      '--- a/t.ts',
      '+++ b/t.ts',
      '@@ -1,0 +1,2 @@',
      '+++ b/x.ts',
      '+line',
      '@@ -9 +10 @@',
      '-old',
      '+new',
    ].join('\n');

    expect(changedRanges(tricky)).toEqual([
      {
        file: 't.ts',
        ranges: [
          [1, 2],
          [10, 10],
        ],
      },
    ]);
  });

  it('reads a Windows line ending, and a path with a space in it', () => {
    // git ends a `+++` name that holds a space with a tab.
    const crlf = [
      'diff --git a/sp ace.ts b/sp ace.ts',
      '--- a/sp ace.ts\t',
      '+++ b/sp ace.ts\t',
      '@@ -3 +3 @@',
      '-a',
      '+b',
    ].join('\r\n');

    expect(changedRanges(crlf)).toEqual([{ file: 'sp ace.ts', ranges: [[3, 3]] }]);
  });

  it('reads line numbers and counts of more than one digit', () => {
    const big = [
      'diff --git a/big.ts b/big.ts',
      '--- a/big.ts',
      '+++ b/big.ts',
      '@@ -120,15 +131,12 @@ export function x() {',
    ].join('\n');

    expect(changedRanges(big)).toEqual([{ file: 'big.ts', ranges: [[131, 142]] }]);
  });

  it('does not read an added line that looks like a hunk header as one', () => {
    const lookalike = [
      'diff --git a/t.ts b/t.ts',
      '--- a/t.ts',
      '+++ b/t.ts',
      '@@ -1,0 +1 @@',
      '+@@ -1 +500 @@',
    ].join('\n');

    expect(changedRanges(lookalike)).toEqual([{ file: 't.ts', ranges: [[1, 1]] }]);
  });

  it('does not cut the diff at a line that only mentions diff --git', () => {
    const mention = [
      'diff --git a/t.ts b/t.ts',
      '--- a/t.ts',
      '+++ b/t.ts',
      '@@ -1,0 +1,2 @@',
      '+// run diff --git a/x.ts b/x.ts',
      '+diff --git b',
      '@@ -9 +10 @@',
      '-a',
      '+b',
    ].join('\n');

    expect(changedRanges(mention)).toEqual([
      {
        file: 't.ts',
        ranges: [
          [1, 2],
          [10, 10],
        ],
      },
    ]);
  });
});

describe('parseArgs — what the run was asked to grade, and against what', () => {
  it('takes every non-flag argument as a path, grading the change by default', () => {
    expect(parseArgs(['src/a.ts', 'src/b.ts'])).toEqual({
      paths: ['src/a.ts', 'src/b.ts'],
      base: undefined,
      wholeFile: false,
      exempt: [],
      sandboxIgnore: [],
      incrementalFile: undefined,
    });
  });

  it('reads --whole-file, for the sweep that grades every function', () => {
    expect(parseArgs(['--whole-file', 'src/a.ts'])).toEqual({
      paths: ['src/a.ts'],
      base: undefined,
      wholeFile: true,
      exempt: [],
      sandboxIgnore: [],
      incrementalFile: undefined,
    });
  });

  it('reads --base <ref> without taking the ref for a path', () => {
    expect(parseArgs(['src/a.ts', '--base', 'origin/main', 'src/b.ts'])).toEqual({
      paths: ['src/a.ts', 'src/b.ts'],
      base: 'origin/main',
      wholeFile: false,
      exempt: [],
      sandboxIgnore: [],
      incrementalFile: undefined,
    });
  });

  it('reads --base=<ref> as the same thing', () => {
    expect(parseArgs(['--base=abc123', 'src/a.ts']).base).toBe('abc123');
  });

  it('reads repeatable --exempt and --sandbox-ignore, which a project passes from its config', () => {
    const args = parseArgs(['--exempt', 'src/db/schema.ts', 'src/a.ts', '--sandbox-ignore', '.scratch', '--exempt=x.ts']);
    expect(args.paths).toEqual(['src/a.ts']);
    expect(args.exempt).toEqual(['src/db/schema.ts', 'x.ts']);
    expect(args.sandboxIgnore).toEqual(['.scratch']);
  });

  it('reads --incremental-file, which turns on Stryker incremental mode', () => {
    expect(parseArgs(['--incremental-file', '.stryker/inc.json', 'src/a.ts']).incrementalFile).toBe('.stryker/inc.json');
    expect(parseArgs(['--incremental-file=x.json']).incrementalFile).toBe('x.json');
  });

  it('reads --sandbox-ignore=<path> as the same thing', () => {
    expect(parseArgs(['--sandbox-ignore=.agents', 'src/a.ts'])).toEqual({
      paths: ['src/a.ts'],
      wholeFile: false,
      exempt: [],
      sandboxIgnore: ['.agents'],
    });
  });

  it('keeps everything after the first = as the value, and an empty value as given', () => {
    expect(parseArgs(['--base=a=b']).base).toBe('a=b');
    expect(parseArgs(['--exempt=', 'src/a.ts'])).toMatchObject({ exempt: [''], paths: ['src/a.ts'] });
  });

  it('grades a path that contains an = as a path', () => {
    expect(parseArgs(['src/a=b.ts', 'constructor']).paths).toEqual(['src/a=b.ts', 'constructor']);
  });

  it('ignores a flag it does not know rather than grading it as a path', () => {
    expect(parseArgs(['--verbose', 'src/a.ts']).paths).toEqual(['src/a.ts']);
    expect(parseArgs(['--whole-file=yes', '--basement=x', 'src/a.ts'])).toEqual({
      paths: ['src/a.ts'],
      wholeFile: false,
      exempt: [],
      sandboxIgnore: [],
    });
  });
});

describe('mutateEntries — what Stryker is told to mutate', () => {
  it('names each changed range as path:start-end, and nothing else', () => {
    // The ranges arrive already widened to whole functions (widenToFunctions);
    // this only spells them the way Stryker reads them.
    const changed = [
      {
        file: 'src/a.ts',
        ranges: [
          [3, 5],
          [20, 20],
        ] as [number, number][],
      },
    ];

    expect(mutateEntries(['src/a.ts'], changed)).toEqual(['src/a.ts:3-5', 'src/a.ts:20-20']);
  });

  it('leaves out a file the change did not touch', () => {
    const changed = [{ file: 'src/a.ts', ranges: [[1, 1]] as [number, number][] }];

    expect(mutateEntries(['src/a.ts', 'src/b.ts'], changed)).toEqual(['src/a.ts:1-1']);
  });

  it('leaves out a changed file that was not asked for', () => {
    const changed = [{ file: 'src/other.ts', ranges: [[1, 1]] as [number, number][] }];

    expect(mutateEntries(['src/a.ts'], changed)).toEqual([]);
  });

  it('still escapes a [locale] path when it carries a range', () => {
    // `[locale]` is a glob character class to Stryker; unescaped, it names
    // `src/app/l/…` and the run finds no file. `[[]` also reads as no glob at
    // all to Stryker's validator, which refuses a glob combined with a range.
    const changed = [
      {
        file: 'src/app/[locale]/[id]/x.ts',
        ranges: [[4, 9]] as [number, number][],
      },
    ];

    expect(mutateEntries(['src/app/[locale]/[id]/x.ts'], changed)).toEqual([
      'src/app/[[]locale]/[[]id]/x.ts:4-9',
    ]);
  });

  it('hands over whole files, escaped, when the run grades whole files', () => {
    // The shape the gate had before code-health/28, kept for the sweep.
    expect(mutateEntries(['src/a.ts', 'src/app/[locale]/x.ts'], null)).toEqual([
      'src/a.ts',
      'src/app/[[]locale]/x.ts',
    ]);
  });
});

describe('splitByChange — whose numbers decide the verdict', () => {
  const fn = (name: string, startLine: number, endLine: number, file = 'src/a.ts') => ({
    name,
    file,
    startLine,
    endLine,
  });
  const changed = [
    {
      file: 'src/a.ts',
      ranges: [
        [70, 70],
        [10, 12],
      ] as [number, number][],
    },
  ];

  it('counts a function whose span overlaps any changed range as touched', () => {
    const { touched, standing } = splitByChange(
      [
        fn('before', 1, 9),
        fn('startsInside', 12, 30),
        fn('endsInside', 5, 10),
        fn('around', 1, 40),
        fn('after', 13, 20),
      ],
      changed,
    );

    expect(touched.map((f) => f.name)).toEqual(['startsInside', 'endsInside', 'around']);
    expect(standing.map((f) => f.name)).toEqual(['before', 'after']);
  });

  it('matches ranges to functions by file', () => {
    const { touched } = splitByChange([fn('elsewhere', 1, 40, 'src/b.ts')], changed);

    expect(touched).toEqual([]);
  });

  it('touches everything when the run grades whole files', () => {
    const all = [fn('a', 1, 2), fn('b', 50, 60, 'src/b.ts')];

    expect(splitByChange(all, null)).toEqual({ touched: all, standing: [] });
  });
});

describe('untrackedChange — a file git has not been told about yet', () => {
  it('is changed from its first line to its last', () => {
    // `git diff <base>` does not show an untracked file at all. Read as
    // "unchanged", a brand-new module would never be graded.
    expect(untrackedChange('src/new.ts', 'a\nb\nc\n')).toEqual({
      file: 'src/new.ts',
      ranges: [[1, 3]],
    });
  });

  it('counts a last line with no newline after it', () => {
    expect(untrackedChange('src/new.ts', 'a\nb')).toEqual({
      file: 'src/new.ts',
      ranges: [[1, 2]],
    });
  });

  it('gives an empty file a one-line range rather than an impossible one', () => {
    // Stryker refuses a range whose end is before its start.
    expect(untrackedChange('src/new.ts', '')).toEqual({
      file: 'src/new.ts',
      ranges: [[1, 1]],
    });
  });
});

describe('emptyMeansMissed — when a run with no mutants is a run that missed', () => {
  // Stryker's own log line, as it prints it (colour codes and all).
  const found = (n: number) =>
    `\u001b[32m14:58:39 (7737) INFO ProjectReader\u001b[39m Found ${n} of 765 file(s) to be mutated.`;

  const A = ['src/a.ts'];
  const A_CHANGED: ChangedFile[] = [{ file: 'src/a.ts', ranges: [[1, 1]] }];

  it('never, when nothing was handed to Stryker for a file that changed', () => {
    // Every changed file exempt from mutation, like src/db/schema.ts.
    const schema = 'src/db/schema.ts';
    expect(emptyMeansMissed([schema], [], [{ file: schema, ranges: [[1, 1]] }], '')).toBe(false);
  });

  it('always, when whole files were handed over — the gate as it was', () => {
    expect(emptyMeansMissed(A, ['src/a.ts'], null, found(1))).toBe(true);
  });

  it('never, in whole-file mode, when every file was exempt from mutation', () => {
    expect(emptyMeansMissed(['src/db/schema.ts'], [], null, '')).toBe(false);
  });

  it('not when Stryker found every file: the changed lines held nothing to mutate', () => {
    // A change to a comment or a type alias has no mutant to offer, and that
    // is not the run failing to cover it.
    const files = ['src/a.ts', 'src/app/[locale]/b.ts'];
    const changed: ChangedFile[] = [
      { file: 'src/a.ts', ranges: [[3, 4], [12, 140]] },
      { file: 'src/app/[locale]/b.ts', ranges: [[1, 2]] },
    ];
    const mutate = ['src/a.ts:3-4', 'src/a.ts:12-140', 'src/app/[[]locale]/b.ts:1-2'];

    expect(emptyMeansMissed(files, mutate, changed, found(2))).toBe(false);
  });

  it('reads a count of more than one digit', () => {
    expect(emptyMeansMissed(A, ['src/a.ts:1-1'], A_CHANGED, found(10))).toBe(false);
  });

  it('when Stryker found fewer files than it was given', () => {
    // The [locale] failure: an entry that names no real file.
    const files = ['src/a.ts', 'src/b.ts'];
    const changed: ChangedFile[] = [...A_CHANGED, { file: 'src/b.ts', ranges: [[1, 1]] }];
    expect(emptyMeansMissed(files, ['src/a.ts:1-1', 'src/b.ts:1-1'], changed, found(1))).toBe(
      true,
    );
  });

  it('when the log does not say what Stryker found — fail closed', () => {
    expect(emptyMeansMissed(A, ['src/a.ts:1-1'], A_CHANGED, 'something else entirely')).toBe(true);
  });

  it('when no named file changed at all — graded nothing is not graded clean', () => {
    // The branch already in origin/main, or a --base holding the change.
    expect(emptyMeansMissed(A, [], [], '')).toBe(true);
  });

  it('not when the only change to a named file deleted lines: graded, nothing to grade (decision #45)', () => {
    expect(emptyMeansMissed(A, [], [{ file: 'src/a.ts', ranges: [] }], '')).toBe(false);
  });

  it('when the diff named only other files', () => {
    // A path that does not match the one asked for, however it came about.
    expect(emptyMeansMissed(A, [], [{ file: 'rc/a.ts', ranges: [[1, 1]] }], '')).toBe(true);
  });

  it('not when one named file changed and another did not', () => {
    const files = ['src/a.ts', 'src/b.ts'];
    expect(emptyMeansMissed(files, ['src/a.ts:1-1'], A_CHANGED, found(1))).toBe(false);
  });
});

describe('strykerMissedFiles — whether Stryker mutated fewer files than it was handed (review #21)', () => {
  const found = (n: number) => `INFO ProjectReader Found ${n} of 765 file(s) to be mutated.`;

  it('when whole files were handed over and Stryker found fewer', () => {
    expect(strykerMissedFiles(['src/a.ts', 'src/b.ts'], found(1))).toBe(true);
  });

  it('when ranges were handed over and Stryker found fewer files than they name', () => {
    expect(strykerMissedFiles(['src/a.ts:1-2', 'src/a.ts:5-9', 'src/b.ts:1-1'], found(1))).toBe(true);
  });

  it('not when Stryker found every named file, counting a file with two ranges once', () => {
    expect(strykerMissedFiles(['src/a.ts:1-2', 'src/a.ts:5-9', 'src/b.ts:1-1'], found(2))).toBe(false);
    expect(strykerMissedFiles(['src/a.ts'], found(10))).toBe(false);
  });

  it('when the log does not say what Stryker found — fail closed', () => {
    expect(strykerMissedFiles(['src/a.ts'], 'something else entirely')).toBe(true);
  });

  it('never when nothing was handed to Stryker', () => {
    expect(strykerMissedFiles([], '')).toBe(false);
  });
});

describe('mutatedFiles — the files a mutate list hands to Stryker (review #27)', () => {
  it('names each file with a range once, in the order given, and leaves out the rest', () => {
    const mutate = ['src/b.ts:1-2', 'src/b.ts:5-9', 'src/a.ts:3-3'];
    expect(mutatedFiles(['src/a.ts', 'src/b.ts', 'src/c.ts'], mutate)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('names whole files, and a [locale] path in its escaped form', () => {
    const files = ['src/app/[locale]/b.ts', 'src/a.ts'];
    expect(mutatedFiles(files, ['src/app/[[]locale]/b.ts'])).toEqual(['src/app/[locale]/b.ts']);
    expect(mutatedFiles(files, ['src/app/[[]locale]/b.ts:4-4'])).toEqual(['src/app/[locale]/b.ts']);
  });

  it('does not take a file for another that only shares its start', () => {
    expect(mutatedFiles(['src/a.ts'], ['src/a.tsx:1-1', 'src/a.ts.bak'])).toEqual([]);
  });
});

describe('untouchedFiles — the named files this run leaves ungraded', () => {
  it('names each file the change did not touch, in the order given', () => {
    const changed: ChangedFile[] = [{ file: 'src/b.ts', ranges: [[1, 1]] }];
    expect(untouchedFiles(['src/c.ts', 'src/b.ts', 'src/a.ts'], changed)).toEqual([
      'src/c.ts',
      'src/a.ts',
    ]);
  });

  it('does not name a file whose diff only deleted lines (decision #45)', () => {
    expect(untouchedFiles(['src/a.ts'], [{ file: 'src/a.ts', ranges: [] }])).toEqual([]);
  });

  it('names none when the run grades whole files', () => {
    expect(untouchedFiles(['src/a.ts'], null)).toEqual([]);
  });
});

describe('widenToFunctions — Stryker is handed whole functions, not bare lines', () => {
  // Stryker keeps a mutant only when its whole node lies inside a range. A
  // range of one line drops every mutant whose node spans more than that line,
  // so the change is widened to each function it touched (GATE-SCOPE's unit).
  const spansOf = (source: string, file = 'src/a.ts') => measureComplexity(file, source);
  const widen = (source: string, ranges: LineRange[], file = 'src/a.ts') =>
    widenToFunctions([{ file, ranges }], spansOf(source, file));

  const MULTI_LINE_IF = [
    'export function allowed(a: number, b: number) {', // 1
    '  if (', // 2
    '    a > 1 &&', // 3
    '    b > 2', // 4
    '  ) {', // 5
    '    return true;', // 6
    '  }', // 7
    '  return false;', // 8
    '}', // 9
    '', // 10
    'export const LIMIT = 3;', // 11
  ].join('\n');

  it('widens one changed line of a multi-line condition to its whole function', () => {
    expect(widen(MULTI_LINE_IF, [[4, 4]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 9]] }]);
  });

  it('widens an added bare statement so the block holding it can be mutated', () => {
    const source = [
      'export async function save(revalidate: () => Promise<void>) {', // 1
      '  const x = 1;', // 2
      '  await revalidate();', // 3
      '  return x;', // 4
      '}', // 5
    ].join('\n');
    const [{ ranges }] = widen(source, [[3, 3]]);

    // The one mutant that tests `await revalidate();` is the BlockStatement
    // mutant emptying the body it sits in. It is kept only if the range holds
    // that block's whole location — which a line range of [3, 3] never did.
    const tree = ts.createSourceFile('a.ts', source, ts.ScriptTarget.Latest, true);
    const fn = tree.statements[0] as ts.FunctionDeclaration;
    const block = rangeOf(fn.body!, tree);
    const statement = rangeOf(fn.body!.statements[1], tree);
    const holds = (lines: { startLine: number; endLine: number }) =>
      ranges.some(([start, end]) => start <= lines.startLine && lines.endLine <= end);

    expect(holds(statement)).toBe(true);
    expect(holds(block)).toBe(true);
  });

  it('widens to arrow functions assigned to consts, and to class methods', () => {
    const source = [
      'export const double = (n: number) => {', // 1
      '  return n * 2;', // 2
      '};', // 3
      'export class Box {', // 4
      '  size = 1;', // 5
      '  grow(by: number) {', // 6
      '    this.size += by;', // 7
      '    return this.size;', // 8
      '  }', // 9
      '}', // 10
    ].join('\n');

    expect(widen(source, [[2, 2]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 3]] }]);
    expect(widen(source, [[8, 8]])).toEqual([{ file: 'src/a.ts', ranges: [[6, 9]] }]);
  });

  const NESTED = [
    'export function outer(xs: number[]) {', // 1
    '  const total = xs.length;', // 2
    '  return xs.map((x) => {', // 3
    '    const y = x * 2;', // 4
    '    return y + total;', // 5
    '  });', // 6
    '}', // 7
  ].join('\n');

  it('widens a line inside a nested function to that function only', () => {
    expect(widen(NESTED, [[5, 5]])).toEqual([{ file: 'src/a.ts', ranges: [[3, 6]] }]);
  });

  it("widens a line of the outer function's own code to the outer function", () => {
    expect(widen(NESTED, [[2, 2]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 7]] }]);
  });

  it('counts a line the nested function shares with its parent as touching both', () => {
    // Line 3 holds `xs.map(` as well as the callback's head: the change may be
    // the parent's, so the parent is widened too.
    expect(widen(NESTED, [[3, 3]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 7]] }]);
    expect(widen(NESTED, [[6, 6]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 7]] }]);
  });

  it('widens a range that crosses two sibling functions to both, merged', () => {
    const source = [
      'export function a() {', // 1
      '  return 1;', // 2
      '}', // 3
      'export function b() {', // 4
      '  return 2;', // 5
      '}', // 6
      'export function c() {', // 7
      '  return 3;', // 8
      '}', // 9
    ].join('\n');

    expect(widen(source, [[2, 5]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 6]] }]);
    expect(
      widen(source, [
        [2, 2],
        [8, 8],
      ]),
    ).toEqual([
      {
        file: 'src/a.ts',
        ranges: [
          [1, 3],
          [7, 9],
        ],
      },
    ]);
  });

  it("widens a function's first and last lines to the function", () => {
    expect(widen(MULTI_LINE_IF, [[1, 1]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 9]] }]);
    expect(widen(MULTI_LINE_IF, [[9, 9]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 9]] }]);
  });

  it('widens a change running out of a nested function into its parent to the parent', () => {
    // Line 5 widens to the callback, line 6 to both: the parent's span wins,
    // whatever order the pieces came in.
    expect(widen(NESTED, [[5, 6]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 7]] }]);
  });

  it('keeps a top-level change outside any function to its own lines', () => {
    expect(widen(MULTI_LINE_IF, [[11, 11]])).toEqual([{ file: 'src/a.ts', ranges: [[11, 11]] }]);
  });

  it('keeps top-level lines apart from a function they do not touch', () => {
    const source = [
      'export const A = 1;', // 1
      'export const B = 2;', // 2
      '', // 3
      'export function f() {', // 4
      '  return A;', // 5
      '}', // 6
    ].join('\n');

    expect(widen(source, [[1, 2]])).toEqual([{ file: 'src/a.ts', ranges: [[1, 2]] }]);
    expect(widen(source, [[2, 5]])).toEqual([{ file: 'src/a.ts', ranges: [[2, 6]] }]);
  });

  it('widens only against the functions of the same file', () => {
    expect(
      widenToFunctions([{ file: 'src/b.ts', ranges: [[4, 4]] }], spansOf(MULTI_LINE_IF)),
    ).toEqual([{ file: 'src/b.ts', ranges: [[4, 4]] }]);
  });

  it('still grades nothing for a change that only deleted lines', () => {
    const deletionOnly = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -6 +5,0 @@',
      '-    extra();',
    ].join('\n');

    expect(widenToFunctions(changedRanges(deletionOnly), spansOf(MULTI_LINE_IF))).toEqual([{ file: 'src/a.ts', ranges: [] }]);
  });
});

describe('parseArgs — the fast merge gate (ticket 31)', () => {
  it('reads --trust, --coverage, --json, --timeout-ms and --timeout-factor as values, never as paths', () => {
    const args = parseArgs(['--trust', 'abc', '--coverage=cov.json', '--json', 'out.json', '--timeout-ms', '9000', '--timeout-factor', '2', 'src/a.ts']);
    expect(args).toEqual({
      paths: ['src/a.ts'],
      wholeFile: false,
      exempt: [],
      sandboxIgnore: [],
      trust: 'abc',
      coverage: 'cov.json',
      json: 'out.json',
      timeoutMs: '9000',
      timeoutFactor: '2',
    });
  });
});

describe('untrustedLines — what a merge changed relative to the cloud tip its gate already graded', () => {
  const sinceBase: ChangedFile[] = [
    { file: 'src/a.ts', ranges: [[1, 10], [20, 30]] },
    { file: 'src/b.ts', ranges: [[5, 5]] },
  ];

  it('keeps only the lines that also differ from the trusted tip', () => {
    const sinceTip: ChangedFile[] = [{ file: 'src/a.ts', ranges: [[4, 4], [9, 22], [40, 50]] }];
    expect(untrustedLines(sinceBase, sinceTip)).toEqual([
      { file: 'src/a.ts', ranges: [[4, 4], [9, 10], [20, 22]] },
      { file: 'src/b.ts', ranges: [] },
    ]);
  });

  it('keeps a file whose every line equals the tip, with nothing to mutate, so it reads as touched', () => {
    expect(untrustedLines(sinceBase, [])).toEqual([
      { file: 'src/a.ts', ranges: [] },
      { file: 'src/b.ts', ranges: [] },
    ]);
  });

  it("never trusts a line by another file's diff against the tip", () => {
    expect(untrustedLines(sinceBase, [{ file: 'src/a.ts', ranges: [[1, 30]] }])).toEqual([
      { file: 'src/a.ts', ranges: [[1, 10], [20, 30]] },
      { file: 'src/b.ts', ranges: [] },
    ]);
  });

  it('keeps a range touching the tip diff at one edge only', () => {
    expect(untrustedLines([{ file: 'f', ranges: [[3, 6]] }], [{ file: 'f', ranges: [[6, 9], [1, 3]] }])).toEqual([{ file: 'f', ranges: [[3, 3], [6, 6]] }]);
  });

  it('trusts nothing when git could not diff against the tip: every changed line stays', () => {
    expect(untrustedLines(sinceBase, null)).toBe(sinceBase);
  });
});
