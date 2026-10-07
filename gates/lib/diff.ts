// Added lines from a unified diff (`git diff -U0`), with the line number each has in the new file.
// Gates that judge only what a change adds (secret scan, hidden Unicode) read these.

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

// No `$`: the greedy `.+` already runs to the end of the row.
const FILE = /^\+\+\+ (?:b\/)?(.+)/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// The file a `+++` header names, or null for a deleted file's `/dev/null`.
const target = (path: string) => (path === '/dev/null' ? null : path);

// A hunk length left out means one line.
const length = (n: string | undefined) => (n === undefined ? 1 : Number(n));

interface Cursor {
  file: string | null;
  next: number;
  /**
   * Lines the current hunk still holds on the new side. The old side needs no count: a removed
   * row read as a header row matches no header, so it changes nothing.
   */
  news: number;
}

/**
 * One row inside a hunk. The hunk header says how many rows follow, so an added line that reads
 * `++ x` (shown as `+++ x`) stays content and is never taken for the next file's header.
 */
function hunkRow(c: Cursor, row: string, out: AddedLine[]): void {
  const kind = row[0];
  // `\ No newline at end of file` belongs to the line before it.
  if (kind === '\\') return;
  if (kind === '+' && c.file) out.push({ file: c.file, line: c.next, text: row.slice(1) });
  if (kind !== '-') c.next++, c.news--;
}

/** A row between hunks: a file header, a hunk header, or anything else git prints there. */
function headerRow(c: Cursor, row: string): void {
  const f = FILE.exec(row);
  const h = HUNK.exec(row);
  if (f) c.file = target(f[1]);
  else if (h) Object.assign(c, { next: Number(h[1]), news: length(h[2]) });
}

export function addedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  // Stryker disable next-line ObjectLiteral: equivalent; an empty cursor reads as no file and no open hunk (undefined > 0 is false), the same as these values
  const c: Cursor = { file: null, next: 0, news: 0 };
  for (const row of diff.split(/\r?\n/)) {
    if (c.news > 0) hunkRow(c, row, out);
    else headerRow(c, row);
  }
  return out;
}
