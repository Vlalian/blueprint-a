import { describe, expect, it } from 'vitest';
import { addedLines } from './diff.ts';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -3,0 +4,2 @@ export function f() {
+const key = 'abc';
+const two = 2;
@@ -10 +12 @@
-old line
+new line
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;

// Split so no secret-shaped literal sits in this file.
const AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';

describe('addedLines', () => {
  it('reads an added line that starts with "++ " as content, not as a new file header', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '--- removed',
      '\\ No newline at end of file',
      `+++ b/${AWS_KEY}`,
      '+next',
      '@@ -9 +10 @@',
      '-x',
      '+y',
    ].join('\n');
    expect(addedLines(diff)).toEqual([
      { file: 'src/a.ts', line: 2, text: `++ b/${AWS_KEY}` },
      { file: 'src/a.ts', line: 3, text: 'next' },
      { file: 'src/a.ts', line: 10, text: 'y' },
    ]);
  });

  it('reads headers only at the start of a row', () => {
    const diff = ['--- a/x', '+++ b/x', 'x +++ b/other', '@@ -1 +1 @@', '+a', 'see @@ -1 +7 @@', '+stray'].join('\n');
    expect(addedLines(diff)).toEqual([{ file: 'x', line: 1, text: 'a' }]);
  });

  it('reads hunk headers whose lengths have several digits', () => {
    const diff = ['--- a/x', '+++ b/x', '@@ -1,12 +1 @@', '+a', '--- a/y', '+++ b/y', '@@ -100,10 +200,2 @@', '+b', '+c'].join('\n');
    expect(addedLines(diff)).toEqual([
      { file: 'x', line: 1, text: 'a' },
      { file: 'y', line: 200, text: 'b' },
      { file: 'y', line: 201, text: 'c' },
    ]);
  });

  it('counts a hunk without a length as one line on each side', () => {
    const diff = ['--- a/x', '+++ b/x', '@@ -4 +4 @@', '-a', '+b', '--- a/y', '+++ b/y', '@@ -0,0 +1 @@', '+c'].join('\n');
    expect(addedLines(diff)).toEqual([
      { file: 'x', line: 4, text: 'b' },
      { file: 'y', line: 1, text: 'c' },
    ]);
  });

  it('reads a header again once a hunk has used up its lines', () => {
    const diff = ['--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', ' same', '-old', '+new', '--- a/y', '+++ b/y', '@@ -0,0 +1 @@', '+z'].join('\n');
    expect(addedLines(diff)).toEqual([
      { file: 'x', line: 2, text: 'new' },
      { file: 'y', line: 1, text: 'z' },
    ]);
  });


  it('returns each added line with its file and new line number, skipping deleted files and removed lines', () => {
    expect(addedLines(DIFF)).toEqual([
      { file: 'src/a.ts', line: 4, text: "const key = 'abc';" },
      { file: 'src/a.ts', line: 5, text: 'const two = 2;' },
      { file: 'src/a.ts', line: 12, text: 'new line' },
    ]);
  });

  it('returns nothing for an empty diff', () => {
    expect(addedLines('')).toEqual([]);
  });

  it('reads a --no-prefix header and multi-digit hunk counts', () => {
    expect(addedLines('+++ src/b.ts\n@@ -10,12 +20,15 @@\n+first\n+second\n')).toEqual([
      { file: 'src/b.ts', line: 20, text: 'first' },
      { file: 'src/b.ts', line: 21, text: 'second' },
    ]);
  });

  it('keeps added lines that only look like headers in the middle, or start with ++', () => {
    expect(addedLines('+++ b/c.ts\n@@ -1 +1,3 @@\n+x +++ y\n+y @@ -1 +9 @@\n+++i;\n')).toEqual([
      { file: 'c.ts', line: 1, text: 'x +++ y' },
      { file: 'c.ts', line: 2, text: 'y @@ -1 +9 @@' },
      { file: 'c.ts', line: 3, text: '++i;' },
    ]);
  });

  it('never attributes a line to /dev/null or to no file at all', () => {
    expect(addedLines('+orphan\n+++ /dev/null\n@@ -0,0 +1 @@\n+x\n')).toEqual([]);
  });

  it('handles CRLF diffs from Windows checkouts', () => {
    expect(addedLines(DIFF.replaceAll('\n', '\r\n'))).toEqual(addedLines(DIFF));
  });
});
