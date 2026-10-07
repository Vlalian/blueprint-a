// Run-time skips are not green (ticket 47). A test that skips itself (`it.skipIf` on a missing env
// var or fixture, a `.todo` left behind) passes the test check without proving anything. The test
// check runs through skips-cli.ts: it runs the project's test command, reads the test runner's JSON
// report (vitest `--reporter=json`, jest `--json`) and counts the skipped and todo tests. More than
// at the base (the commit before the role) fails the check, naming the ones the base did not skip.
// The base's list comes from a cache keyed by the base's tree, which every guarded run fills for
// the tree it ran on; on a miss the test command runs once in a checkout of the base. Pure; the
// test command, git and the files are injected.

import { posix } from 'node:path';

const SKIPPED = ['skipped', 'pending', 'todo', 'disabled'];

type Report = { testResults: Array<{ name: string; assertionResults?: Array<{ fullName: string; status: string }> }> };

const slash = (p: string) => p.split('\\').join('/');

/** A test file's path from the folder the tests ran in (in any letter case: Windows names a drive c: or C:); as it is when it lies outside it. */
function fromDir(file: string, dir: string): string {
  const prefix = `${slash(dir).replace(/\/$/, '')}/`;
  const path = slash(file);
  return path.toLowerCase().startsWith(prefix.toLowerCase()) ? path.slice(prefix.length) : path;
}

function parsed(report: string | undefined): Report | undefined {
  try {
    const r = JSON.parse(report as string) as Report;
    return Array.isArray(r.testResults) ? r : undefined;
  } catch {}
}

/** The skipped and todo tests of a JSON test report, as `<file from dir> > <full name>`; undefined when it is no test report. */
export function skippedIn(report: string | undefined, dir: string): string[] | undefined {
  return parsed(report)?.testResults.flatMap((file) =>
    file.assertionResults?.filter((t) => SKIPPED.includes(t.status)).map((t) => `${fromDir(file.name, dir)} > ${t.fullName}`) ?? [],
  );
}

/** The skipped tests the base did not skip (a name skipped twice counts twice), when more are skipped than at the base; none otherwise. */
export function newSkips(now: string[], base: string[]): string[] {
  const left = [...base];
  const added = now.filter((name) => {
    const at = left.indexOf(name);
    if (at >= 0) left.splice(at, 1);
    return at < 0;
  });
  return now.length > base.length ? added : [];
}

export interface SkipsIo {
  /** Runs the test command in the folder. */
  test(dir: string): { exitCode: number; output: string };
  /** The report the test command wrote in the folder, removed once read; undefined when it wrote none. */
  report(dir: string): string | undefined;
  /** Removes a report an earlier run left in the folder. */
  clearReport(dir: string): void;
  /** The worktree's tree hash, untracked files included; undefined when git names none. */
  tree(cwd: string): string | undefined;
  /** A commit's tree hash. */
  treeOf(ref: string): string;
  /** A checkout of the base; remove() deletes it again. */
  checkoutBase(base: string): { dir: string; remove(): void };
  /** The file's text, or undefined when it does not exist. */
  read(path: string): string | undefined;
  /** Writes the file, creating its folder. */
  write(path: string, text: string): void;
}

export interface SkipsAt {
  cwd: string;
  /** The commit before the role ({BASE}). */
  base: string;
  /** The folder of skipped-test lists by tree hash. */
  cache: string;
}

/** The test command's run in a folder, with the skipped tests of its report. */
function testRun(dir: string, io: SkipsIo) {
  io.clearReport(dir);
  const run = io.test(dir);
  return { run, skipped: skippedIn(io.report(dir), dir) };
}

function cachedList(text: string | undefined): string[] | undefined {
  try {
    const list = JSON.parse(text as string) as unknown;
    return Array.isArray(list) ? (list as string[]) : undefined;
  } catch {}
}

/** The base's skipped tests, from the cache or a run in a checkout of the base; undefined when that run wrote no report. */
function baseSkips(at: SkipsAt, io: SkipsIo): string[] | undefined {
  const path = posix.join(at.cache, `${io.treeOf(at.base)}.json`);
  const cached = cachedList(io.read(path));
  if (cached !== undefined) return cached;
  const checkout = io.checkoutBase(at.base);
  try {
    const { skipped } = testRun(checkout.dir, io);
    if (skipped !== undefined) io.write(path, JSON.stringify(skipped));
    return skipped;
  } finally {
    checkout.remove();
  }
}

const NO_REPORT = 'The test command wrote no test report, so its skipped tests cannot be counted; a test that did not run is not green.';

/** What fails a run on its skips, or undefined when nothing does. */
function skipFailure(now: string[] | undefined, at: SkipsAt, io: SkipsIo): string | undefined {
  if (now === undefined) return NO_REPORT;
  const base = baseSkips(at, io);
  if (base === undefined) return `The test command wrote no test report at the base (${at.base}), so the skipped tests there cannot be counted.`;
  const added = newSkips(now, base);
  if (added.length === 0) return undefined;
  const intro = `Skipped tests: ${now.length}, at the base (${at.base}) ${base.length}. A skipped test is not a passing one; these were not skipped at the base:`;
  return [intro, ...added.map((name) => `- ${name}`)].join('\n');
}

/** The project's test command as the test check runs it: its own exit code and output, failed on more skipped tests than at the base. */
export function guardedTest(at: SkipsAt, io: SkipsIo): { exitCode: number; output: string } {
  const tree = io.tree(at.cwd);
  const { run, skipped } = testRun(at.cwd, io);
  if (tree !== undefined && skipped !== undefined) io.write(posix.join(at.cache, `${tree}.json`), JSON.stringify(skipped));
  const failure = skipFailure(skipped, at, io);
  if (failure === undefined) return run;
  return { exitCode: run.exitCode || 1, output: `${run.output}\n${failure}\n` };
}
