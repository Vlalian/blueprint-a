/**
 * What a run of the gate grades — the decisions behind its scope, as pure
 * functions.
 *
 * The rule (`.scratch/onkel/GATE-SCOPE.md`, the owner 2026-09-03) is **grade only
 * the functions the change actually touched**. A violation elsewhere in a file
 * the change edited is recorded, not a blocker. Until code-health/28 the tool
 * did not apply that rule itself: it handed Stryker whole files and judged
 * every function in them, so each build paid the full mutation cost of every
 * big file it touched and then sorted old debt from new by hand.
 *
 * "Touched" is read off `git diff -U0 <base>`: the lines the change added or
 * modified, on the new side. Stryker is then handed each function those lines
 * touch, whole (`widenToFunctions`) — never the bare lines, which silently
 * drop every mutant whose node spans more than them. `cli.ts` runs git and hands the text here; every
 * decision about it is made in this module, where it can be mutation-tested.
 */

/** An inclusive, 1-based line range on the new side of a diff. */
export type LineRange = [start: number, end: number];

export type ChangedFile = { file: string; ranges: LineRange[] };

/** `@@ -a[,b] +c[,d] @@` — only the new side matters here. */
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * A `+++ b/<path>` header's path. git ends a name holding a space with a tab,
 * which is cut here. A name holding a quote, a backslash or a control
 * character comes quoted and is not unpicked: no source path in this repo
 * has one.
 */
function headerPath(raw: string): string {
  return raw.split('\t')[0].slice(2);
}

/** The new-side range of one hunk header, or null for a pure deletion. */
function hunkRange(line: string): LineRange | null {
  const match = HUNK.exec(line);
  if (match === null) return null;
  const start = Number(match[1]);
  // An omitted count means one line; a count of 0 means nothing was added.
  const count = match[2] === undefined ? 1 : Number(match[2]);
  return count === 0 ? null : [start, start + count - 1];
}

/**
 * The diff cut at each `diff --git`, one section per file. No line inside a
 * hunk can begin that way — each starts with `+`, `-`, ` ` or `\\`.
 */
function fileSections(diffU0: string): string[][] {
  return diffU0.split(/^diff --git /m).map((section) => section.split(/\r?\n/));
}

/**
 * One file's changed ranges, or null when the section names no new-side file
 * (a rename or mode change with no content, a binary file, a deleted file).
 *
 * The `+++ ` header comes before any hunk, so the first line beginning that
 * way is always the header, never an added line that happens to begin `++ `.
 * A file with hunks but no range only deleted lines (decision #45): it is
 * kept, with nothing to grade, so it reads as touched rather than missed.
 */
function changedFile(section: string[]): ChangedFile | null {
  const header = section.find((line) => line.startsWith('+++ '));
  if (header === undefined || header === '+++ /dev/null') return null;
  if (!section.some((line) => HUNK.test(line))) return null;

  const ranges = section.map(hunkRange).filter((r): r is LineRange => r !== null);
  return { file: headerPath(header.slice(4)), ranges };
}

/**
 * The added or modified lines of every file in a `git diff -U0` text.
 *
 * A pure deletion yields no range: there is no new line for a test to be
 * checking. A file whose diff only deletes lines is still listed, with no
 * range: graded, with nothing to grade. A deleted file, and a rename that
 * changed no content, are absent.
 */
export function changedRanges(diffU0: string): ChangedFile[] {
  return fileSections(diffU0)
    .map(changedFile)
    .filter((f): f is ChangedFile => f !== null);
}

type Span = { file: string; startLine: number; endLine: number };

function contains(fn: Span, line: number): boolean {
  return fn.startLine <= line && line <= fn.endLine;
}

function shorter(a: Span, b: Span): boolean {
  return a.endLine - a.startLine < b.endLine - b.startLine;
}

/**
 * Whether `line` is `fn`'s own code: inside it, and not strictly between the
 * first and last lines of a function nested in it. A nested function's first
 * and last lines are shared — `xs.map((x) => {` is the parent's code as well.
 *
 * Functions nest or sit apart, so a shorter function holding a line of `fn`
 * strictly inside it can only be one nested in `fn`.
 */
function owns(fn: Span, line: number, spans: Span[]): boolean {
  return (
    contains(fn, line) &&
    !spans.some((g) => shorter(g, fn) && g.startLine < line && line < g.endLine)
  );
}

/** One changed line, as the spans of the functions whose code it is, or itself. */
function widenLine(line: number, spans: Span[]): LineRange[] {
  const owners = spans.filter((fn) => owns(fn, line, spans));
  if (owners.length === 0) return [[line, line]];
  return owners.map((fn): LineRange => [fn.startLine, fn.endLine]);
}

/** Sorted, with overlapping and adjacent ranges joined into one. */
function merge(ranges: LineRange[]): LineRange[] {
  const merged: LineRange[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last !== undefined && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * Each changed range widened to the full span of every function it touched —
 * what Stryker is handed, so the mutants of the touched function all survive
 * its range filter (the owner, 2026-09-25, code-health/28).
 *
 * Stryker keeps a mutant only when its **whole node** lies inside a range. Fed
 * bare changed lines, an edit to one line of a multi-line condition dropped
 * that condition's mutants, and an added `await revalidate();` got none at
 * all: the only mutant that tests it empties the enclosing block, which no
 * one-line range holds. The gate then passed code nothing tested.
 *
 * A line is widened to the innermost function(s) whose own code it is; a line
 * a nested function shares with its parent widens to both. A changed line
 * outside every function keeps its own line. `spans` are every function of
 * the files, nested ones included, as `measureComplexity` reports them.
 */
export function widenToFunctions(changed: ChangedFile[], spans: Span[]): ChangedFile[] {
  return changed.map(({ file, ranges }) => {
    const own = spans.filter((fn) => fn.file === file);
    const lines = ranges.flatMap(([start, end]) =>
      Array.from({ length: end - start + 1 }, (_, i) => start + i),
    );
    return { file, ranges: merge(lines.flatMap((line) => widenLine(line, own))) };
  });
}

export type GateArgs = {
  /** The files named on the command line, as given. */
  paths: string[];
  /** The ref to diff against; unset means the merge-base with `origin/main`. */
  base?: string;
  /** Grade every function in each file — the post-test sweep, and today's behaviour before code-health/28. */
  wholeFile: boolean;
  /** Files graded for CRAP but never mutated; each project lists its own (`--exempt`, repeatable). */
  exempt: string[];
  /** Paths Stryker must not copy into its sandbox, e.g. junctions (`--sandbox-ignore`, repeatable). */
  sandboxIgnore: string[];
  /** Where Stryker keeps incremental results; set means only changed mutants are re-tested. */
  incrementalFile?: string;
  /** A commit whose own gate graded its lines: only lines that differ from it are mutated (ticket 31). */
  trust?: string;
  /** A coverage-final.json from a unit run already made: CRAP is graded from it, the suite is not run again. */
  coverage?: string;
  /** Where to write the machine-readable result (files, mutants, survivors, suppressions, timeouts). */
  json?: string;
  /** Stryker's timeoutMS and timeoutFactor, as given; unset leaves Stryker's own defaults. */
  timeoutMs?: string;
  timeoutFactor?: string;
};

/**
 * The flags that carry a value, and where each value goes. A Map, not an
 * object literal, so a path that happens to be called `constructor` is never
 * looked up as a flag.
 */
const VALUE_FLAGS = new Map<string, (args: GateArgs, value: string) => void>([
  ['--base', (args, value) => { args.base = value; }],
  ['--exempt', (args, value) => { args.exempt.push(value); }],
  ['--sandbox-ignore', (args, value) => { args.sandboxIgnore.push(value); }],
  ['--incremental-file', (args, value) => { args.incrementalFile = value; }],
  ['--trust', (args, value) => { args.trust = value; }],
  ['--coverage', (args, value) => { args.coverage = value; }],
  ['--json', (args, value) => { args.json = value; }],
  ['--timeout-ms', (args, value) => { args.timeoutMs = value; }],
  ['--timeout-factor', (args, value) => { args.timeoutFactor = value; }],
]);

/** `--flag=value` as its flag and value; anything without an `=` is all flag, with no value. */
function splitAtEquals(arg: string): [flag: string, value: string | undefined] {
  const eq = arg.indexOf('=');
  return eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
}

/**
 * Reads `argv[i]` into `args` and returns the index of the last argument it
 * used: `i` itself, or `i + 1` when a value flag took the next argument.
 */
function readArg(args: GateArgs, argv: string[], i: number): number {
  const arg = argv[i];
  const [flag, inline] = splitAtEquals(arg);
  const put = VALUE_FLAGS.get(flag);
  if (put) {
    if (inline !== undefined) {
      put(args, inline);
      return i;
    }
    put(args, argv[i + 1]);
    return i + 1;
  }
  if (arg === '--whole-file') args.wholeFile = true;
  else if (!arg.startsWith('--')) args.paths.push(arg);
  return i;
}

/**
 * `npm run quality -- [--whole-file] [--base <ref>] [--exempt <path>]…
 * [--sandbox-ignore <path>]… [--incremental-file <path>] <path…>`.
 *
 * A value flag takes the next argument as its value (or the text after `=`),
 * so a ref is never graded as a path. Any other flag is ignored rather than
 * read as one.
 */
export function parseArgs(argv: string[]): GateArgs {
  const args: GateArgs = { paths: [], wholeFile: false, exempt: [], sandboxIgnore: [] };
  for (let i = 0; i < argv.length; i++) i = readArg(args, argv, i);
  return args;
}

/** The lines two ranges share, as none or one range. */
function overlap([a, b]: LineRange, [c, d]: LineRange): LineRange[] {
  const start = Math.max(a, c);
  const end = Math.min(b, d);
  return start <= end ? [[start, end]] : [];
}

/**
 * The merge gate's mutation scope (ticket 31): of the lines `changed` since the base, only those
 * that also differ from a commit whose own gate already mutated them (the cloud branch's tip,
 * `sinceTrusted` being the diff against it). A line identical to the tip is trusted from its
 * gate; a conflict resolution or a local fix is not. Every changed file stays listed, with no
 * range when all its lines equal the tip, so it reads as touched rather than missed. With
 * `sinceTrusted` null git could not say, and nothing is trusted.
 */
export function untrustedLines(changed: ChangedFile[], sinceTrusted: ChangedFile[] | null): ChangedFile[] {
  if (sinceTrusted === null) return changed;
  return changed.map(({ file, ranges }) => {
    const other = sinceTrusted.filter((f) => f.file === file).flatMap((f) => f.ranges);
    return { file, ranges: ranges.flatMap((r) => other.flatMap((o) => overlap(r, o))).sort((x, y) => x[0] - y[0]) };
  });
}

/**
 * A new file git has not been told about. `git diff <base>` leaves it out
 * altogether, and read as "unchanged" a brand-new module would never be
 * graded — so it counts as changed from its first line to its last.
 */
export function untrackedChange(file: string, source: string): ChangedFile {
  // An empty file still counts one line, which is what Stryker needs: it
  // refuses a range that ends before it starts.
  const lines = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
  return { file, ranges: [[1, lines]] };
}

/**
 * A repo path as a Stryker `mutate` entry that matches it, and only it.
 *
 * Stryker reads `mutate` as globs, and `[locale]` is a character class: as a
 * glob, `src/app/[locale]/x.ts` names `src/app/l/x.ts` and nothing real, so
 * Stryker found no file, generated no mutants, and the gate reported every
 * server action under the locale segment as clean. `[[]` is the one escape
 * that survives Stryker's own `path.resolve` and backslash-to-slash
 * normalisation of the pattern; a `\[` would be flattened on Windows. It also
 * reads as no glob at all to Stryker's validator, which refuses a glob
 * combined with a line range (checked against `@stryker-mutator/core` 10.0.0).
 */
function asMutateGlob(path: string): string {
  return path.replaceAll('[', '[[]');
}

/**
 * Stryker's `mutate` list: each range as `path:start-end`, or, with `changed`
 * null, each whole file.
 *
 * Stryker keeps a mutant only when its whole location sits inside a range, so
 * the ranges handed here are the touched functions' spans from
 * `widenToFunctions`, not the raw changed lines. A file with no changed lines
 * is absent, and is not mutated at all.
 */
export function mutateEntries(files: string[], changed: ChangedFile[] | null): string[] {
  if (changed === null) return files.map(asMutateGlob);
  return changed
    .filter(({ file }) => files.includes(file))
    .flatMap(({ file, ranges }) =>
      ranges.map(([start, end]) => `${asMutateGlob(file)}:${start}-${end}`),
    );
}

/** The files `mutate` hands to Stryker, in the order of `files`: the ones it can blame (review #27). */
export function mutatedFiles(files: string[], mutate: string[]): string[] {
  // Each entry is `path` or `path:start-end`, and no path here holds a colon.
  const named = new Set(mutate.map((entry) => entry.split(':')[0]));
  return files.filter((file) => named.has(asMutateGlob(file)));
}

function touches(fn: Span, changed: ChangedFile[]): boolean {
  return changed.some(
    ({ file, ranges }) =>
      file === fn.file && ranges.some(([start, end]) => fn.startLine <= end && fn.endLine >= start),
  );
}

/**
 * The functions whose numbers decide the verdict, and the ones left standing.
 *
 * A function is touched when its span overlaps a changed range. Everything is
 * still measured; only the touched can fail the run. With `changed` null the
 * run grades whole files, and every function is touched.
 */
export function splitByChange<T extends Span>(
  fns: T[],
  changed: ChangedFile[] | null,
): { touched: T[]; standing: T[] } {
  if (changed === null) return { touched: fns, standing: [] };
  return {
    touched: fns.filter((fn) => touches(fn, changed)),
    standing: fns.filter((fn) => !touches(fn, changed)),
  };
}

/**
 * The named files with no changed line: measured, reported by name, and not
 * graded. With `changed` null the run grades whole files, and none is left out.
 */
export function untouchedFiles(files: string[], changed: ChangedFile[] | null): string[] {
  if (changed === null) return [];
  return files.filter((f) => !changed.some(({ file }) => file === f));
}

/** Stryker's log line saying how many files its `mutate` list resolved to. */
const FOUND = /Found (\d+) of \d+ file\(s\) to be mutated/;

/**
 * Whether a mutation run that produced no mutants should be read as one that
 * missed the change — the `ranMutation` that `judge`'s no-mutants rule keys
 * off.
 *
 * Whole files always did, which is the gate as it was. A changed range need
 * not: a change to a comment or a type alias has no mutant to offer. So a
 * scoped run is suspect only when Stryker's log shows it found fewer files
 * than it was handed — the `[locale]` failure, an entry naming no real file —
 * or does not say what it found, which fails closed.
 *
 * A scoped run in which **no** named file changed is always a miss. It
 * graded nothing and would otherwise print PASS: the branch was already in
 * `origin/main`, `--base` named the commit that holds the change, or the
 * paths were not the change's. The fix is `--whole-file` or a `--base` that
 * predates the change, and the run says so rather than passing.
 */
export function emptyMeansMissed(
  files: string[],
  mutate: string[],
  changed: ChangedFile[] | null,
  strykerLog: string,
): boolean {
  if (changed === null) return mutate.length > 0;
  if (untouchedFiles(files, changed).length === files.length) return true;
  return strykerMissedFiles(mutate, strykerLog);
}

/**
 * Whether Stryker's log shows it found fewer files than its `mutate` list
 * names, or does not say (fail closed). A named file it never found was never
 * mutated, and the mutants of the files it did find would read as the whole
 * story — in whole-file runs and scoped runs alike (review #21).
 */
export function strykerMissedFiles(mutate: string[], strykerLog: string): boolean {
  if (mutate.length === 0) return false;
  const found = FOUND.exec(strykerLog);
  // Each entry is `path` or `path:start-end`, and no path here holds a colon.
  const named = new Set(mutate.map((entry) => entry.split(':')[0])).size;
  return found === null || Number(found[1]) < named;
}
