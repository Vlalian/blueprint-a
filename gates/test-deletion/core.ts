// Test-deletion guard: a test that existed at the base and is gone now fails the gate unless
// the plan lists it. Enforces onkel's rule "a test deleted during a refactor may not move the
// numbers", which no flow enforced before. Titles are found by pattern, not by parsing, so a
// renamed test counts as deleted; the plan lists it to allow it. A test switched off (`.skip`,
// `.todo`, `xit`, or inside `xdescribe` / `describe.skip`) counts as deleted too (decision 36).

export interface DeletedTest {
  file: string;
  title: string;
}

export interface TestCase {
  title: string;
  /** False when the test is switched off: skipped, todo, or in a skipped group. */
  active: boolean;
}

const TITLE = /\b(x?)(?:it|test)((?:\.(?:only|skip|todo|concurrent))*)(?:\.each\([\s\S]*?\))?\(\s*(['"`])((?:\\.|(?!\3)[\s\S])*?)\3/g;
// A group call that switches off every test in it; the match ends where its brackets open.
const OFF_GROUP = /\b(?:xdescribe|describe(?:\.\w+)*?\.(?:skip|todo))(?:\.each)?(?=\()/g;
// A string literal (skipped whole, so a bracket in it does not count) or a bracket.
const TOKEN = /(['"`])(?:\\.|(?!\1)[\s\S])*?\1|[()]/g;
const DEPTH: Record<string, number> = { '(': 1, ')': -1 };

/** Where the bracket group opening at `open` closes (one past it); the end of the text when it never does. */
function callEnd(source: string, open: number): number {
  let depth = 1;
  for (const m of source.slice(open + 1).matchAll(TOKEN)) {
    depth += DEPTH[m[0]] ?? 0;
    if (depth === 0) return open + 1 + m.index + 1;
  }
  return source.length;
}

/** The stretch of each switched-off group: its name up to the close of its last chained call. */
function offGroups(source: string): Array<[number, number]> {
  return [...source.matchAll(OFF_GROUP)].map((m) => {
    let end = callEnd(source, m.index + m[0].length);
    while (source[end] === '(') end = callEnd(source, end);
    return [m.index, end];
  });
}

export function testCases(source: string): TestCase[] {
  // The text with every switched-off group blanked out; a test call still found there is on.
  const shown = offGroups(source).reduce((text, [from, to]) => text.slice(0, from) + ' '.repeat(to - from) + text.slice(to), source);
  const on = new Set([...shown.matchAll(TITLE)].map((m) => m.index));
  // Group 4 is not optional, so every match carries the title.
  return [...source.matchAll(TITLE)].map((m) => ({
    title: m[4],
    active: m[1] === '' && !/\.(?:skip|todo)/.test(m[2]) && on.has(m.index),
  }));
}

export function testTitles(source: string): string[] {
  return testCases(source).map((c) => c.title);
}

/**
 * Whether `test` is still in `kept`: an active test needs an active copy, one already off at the
 * base any copy. A match is used up so it cannot answer for a second copy.
 */
function takeKept(kept: TestCase[], test: TestCase): boolean {
  const at = kept.findIndex((k) => k.title === test.title && (k.active || !test.active));
  if (at === -1) return false;
  kept.splice(at, 1);
  return true;
}

// The tests still present in a head file, each as often as it appears there; a file deleted at
// head keeps none. Counting copies matters: two tests named 'works' in two describe blocks are
// two tests, and deleting one of them is a deletion.
function deletedFromFile(file: string, source: string, now: string | undefined, allowed: string[]): DeletedTest[] {
  // Stryker disable next-line StringLiteral: equivalent; any text without a test call yields no tests, as '' does
  const kept = testCases(now ?? '');
  const base = testCases(source);
  // Active tests take their copies first, so a test that was already off cannot use one up.
  const gone = new Set([...base.filter((t) => t.active), ...base.filter((t) => !t.active)].filter((t) => !takeKept(kept, t)));
  return base.filter((t) => gone.has(t) && !allowed.includes(`${file}::${t.title}`)).map((t) => ({ file, title: t.title }));
}

export function deletedTests(
  base: Record<string, string>,
  head: Record<string, string>,
  allowed: string[],
): DeletedTest[] {
  return Object.entries(base)
    .filter(([file]) => !allowed.includes(file))
    .flatMap(([file, source]) => deletedFromFile(file, source, head[file], allowed));
}
