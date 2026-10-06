import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { guardedTest, newSkips, skippedIn, type SkipsIo } from './skips.ts';

// Two reports vitest 4 wrote (`--reporter=json`, durations dropped) for test/fixtures/skips/db.test.ts.txt:
// base.json with DATABASE_URL set, now.json without it, so its key test skips itself (it.skipIf).
const FIXTURES = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'skips');
const recorded = (name: string) => readFileSync(join(FIXTURES, `${name}.json`), 'utf8');
const RAN_IN = '/work/repo/.tmp-skips';
const SAVES = 'src/db.test.ts > orders saves an order to the database';
const TODO = 'src/db.test.ts > orders refunds an order';

const report = (name: string, ...tests: Array<[string, string]>) =>
  JSON.stringify({ testResults: [{ name, assertionResults: tests.map(([fullName, status]) => ({ fullName, status })) }] });

describe('skippedIn', () => {
  it('names the skipped and todo tests of a recorded vitest report, by file from the folder it ran in and full name', () => {
    expect(skippedIn(recorded('now'), RAN_IN)).toEqual([SAVES, TODO]);
    expect(skippedIn(recorded('base'), RAN_IN)).toEqual([TODO]);
  });

  it("counts jest's pending and disabled too, and every file of the report", () => {
    const two = JSON.parse(report('C:/w/a.test.ts', ['a', 'pending'], ['b', 'passed'], ['c', 'failed']));
    two.testResults.push({ name: 'C:/w/b.test.ts', assertionResults: [{ fullName: 'd', status: 'disabled' }, { fullName: 'e', status: 'skipped' }] });
    expect(skippedIn(JSON.stringify(two), 'C:/w')).toEqual(['a.test.ts > a', 'b.test.ts > d', 'b.test.ts > e']);
  });

  it('reads Windows paths in either slash and drive letters in either case, and keeps a file outside the folder as it is', () => {
    expect(skippedIn(report('C:\\w\\src\\a.test.ts', ['x', 'skipped']), 'C:\\w')).toEqual(['src/a.test.ts > x']);
    expect(skippedIn(report('C:/w/src/a.test.ts', ['x', 'skipped']), 'C:\\w\\')).toEqual(['src/a.test.ts > x']);
    expect(skippedIn(report('c:/W/src/a.test.ts', ['x', 'skipped']), 'C:\\w')).toEqual(['src/a.test.ts > x']);
    expect(skippedIn(report('/other/a.test.ts', ['x', 'skipped']), '/w')).toEqual(['/other/a.test.ts > x']);
    expect(skippedIn(report('/wx/a.test.ts', ['x', 'skipped']), '/w')).toEqual(['/wx/a.test.ts > x']);
  });

  it('is undefined when there is no report or it is not a test report', () => {
    for (const bad of [undefined, '', '{nope', '{}', 'null', '{"testResults":{}}']) expect(skippedIn(bad, '/w')).toBeUndefined();
  });

  it('reads a file without assertion results as no tests', () => {
    expect(skippedIn(JSON.stringify({ testResults: [{ name: '/w/a.test.ts' }] }), '/w')).toEqual([]);
  });
});

describe('newSkips', () => {
  it('is none when no more tests are skipped than at the base', () => {
    expect(newSkips([TODO], [TODO])).toEqual([]);
    expect(newSkips([], [TODO])).toEqual([]);
    expect(newSkips(['b'], ['a'])).toEqual([]);
  });

  it('names the skipped tests the base did not skip, once more are skipped than at the base', () => {
    expect(newSkips([SAVES, TODO], [TODO])).toEqual([SAVES]);
    expect(newSkips(['b', 'c', 'a'], ['a'])).toEqual(['b', 'c']);
  });

  it('counts a name skipped twice (it.each) as two', () => {
    expect(newSkips(['a', 'a'], ['a'])).toEqual(['a']);
  });
});

/** The guard's I/O in memory: the test command's runs per folder, its reports, a cache, and what happened. */
function fakeIo(o: { now?: string; base?: string; exitCode?: number; tree?: string; cached?: Record<string, string> } = {}) {
  const files = new Map(Object.entries(o.cached ?? {}));
  const log: string[] = [];
  const reports: Record<string, string | undefined> = { '/w': o.now, '/w/.red-check/skips-base': o.base };
  const io: SkipsIo = {
    test: (dir) => (log.push(`test ${dir}`), { exitCode: dir === '/w' ? (o.exitCode ?? 0) : 0, output: `ran in ${dir}\n` }),
    report: (dir) => (log.push(`report ${dir}`), reports[dir]),
    clearReport: (dir) => void log.push(`clear ${dir}`),
    tree: () => o.tree,
    treeOf: (ref) => `tree-of-${ref}`,
    checkoutBase: (base) => (log.push(`checkout ${base}`), { dir: '/w/.red-check/skips-base', remove: () => void log.push('remove base') }),
    read: (path) => files.get(path),
    write: (path, text) => void files.set(path, text),
  };
  return { io, files, log };
}

const AT = { cwd: '/w', base: 'abc123', cache: '/git/workflow-skips' };
const now = (...tests: Array<[string, string]>) => report('/w/src/db.test.ts', ...tests);
const base = (...tests: Array<[string, string]>) => report('/w/.red-check/skips-base/src/db.test.ts', ...tests);

describe('guardedTest', () => {
  it('passes the test run through when no more tests are skipped than at the base, running the base in a checkout it removes', () => {
    const f = fakeIo({ now: now(['a', 'passed'], ['b', 'todo']), base: base(['a', 'passed'], ['b', 'todo']), tree: 'T1' });
    expect(guardedTest(AT, f.io)).toEqual({ exitCode: 0, output: 'ran in /w\n' });
    expect(f.log).toEqual(['clear /w', 'test /w', 'report /w', 'checkout abc123', 'clear /w/.red-check/skips-base', 'test /w/.red-check/skips-base', 'report /w/.red-check/skips-base', 'remove base']);
    expect(Object.fromEntries(f.files)).toEqual({ '/git/workflow-skips/T1.json': '["src/db.test.ts > b"]', '/git/workflow-skips/tree-of-abc123.json': '["src/db.test.ts > b"]' });
  });

  it('fails a green run with one more skipped test than the base, naming it', () => {
    const f = fakeIo({ now: now(['a', 'skipped'], ['b', 'todo']), base: base(['a', 'passed'], ['b', 'todo']) });
    expect(guardedTest(AT, f.io)).toEqual({
      exitCode: 1,
      output: 'ran in /w\n\nSkipped tests: 2, at the base (abc123) 1. A skipped test is not a passing one; these were not skipped at the base:\n- src/db.test.ts > a\n',
    });
  });

  it("keeps a red test run's own exit code, and still names the new skips", () => {
    const f = fakeIo({ now: now(['a', 'skipped']), base: base(['a', 'passed']), exitCode: 3 });
    const r = guardedTest(AT, f.io);
    expect(r.exitCode).toBe(3);
    expect(r.output).toContain('- src/db.test.ts > a');
  });

  it("takes the base's skipped tests from the cache by the base's tree, without a checkout", () => {
    const f = fakeIo({ now: now(['a', 'skipped']), cached: { '/git/workflow-skips/tree-of-abc123.json': '["src/db.test.ts > a"]' } });
    expect(guardedTest(AT, f.io)).toEqual({ exitCode: 0, output: 'ran in /w\n' });
    expect(f.log).toEqual(['clear /w', 'test /w', 'report /w']);
  });

  it('runs the base again when the cached entry is not a list', () => {
    const f = fakeIo({ now: now(['a', 'passed']), base: base(['a', 'passed']), cached: { '/git/workflow-skips/tree-of-abc123.json': '{nope' } });
    expect(guardedTest(AT, f.io).exitCode).toBe(0);
    expect(f.log).toContain('checkout abc123');
  });

  it('fails closed when the test command wrote no report, here or at the base, keeping a red exit code', () => {
    expect(guardedTest(AT, fakeIo({ base: base() }).io)).toEqual({
      exitCode: 1,
      output: 'ran in /w\n\nThe test command wrote no test report, so its skipped tests cannot be counted; a test that did not run is not green.\n',
    });
    expect(guardedTest(AT, fakeIo({ base: base(), exitCode: 2 }).io).exitCode).toBe(2);
    const noReport = fakeIo({ base: base(), tree: 'T1' });
    guardedTest(AT, noReport.io);
    expect([...noReport.files.keys()]).toEqual([]);
    expect(guardedTest(AT, fakeIo({ now: now() }).io)).toEqual({
      exitCode: 1,
      output: 'ran in /w\n\nThe test command wrote no test report at the base (abc123), so the skipped tests there cannot be counted.\n',
    });
    const noBaseReport = fakeIo({ now: now() });
    guardedTest(AT, noBaseReport.io);
    expect([...noBaseReport.files.keys()]).toEqual([]);
  });

  it('removes the base checkout even when the base run throws', () => {
    const f = fakeIo({ now: now() });
    f.io.test = (dir) => {
      if (dir !== '/w') throw new Error('spawn failed');
      return { exitCode: 0, output: '' };
    };
    expect(() => guardedTest(AT, f.io)).toThrow('spawn failed');
    expect(f.log.at(-1)).toBe('remove base');
  });

  it('caches nothing for the worktree when git names no tree', () => {
    const f = fakeIo({ now: now(['a', 'passed']), cached: { '/git/workflow-skips/tree-of-abc123.json': '[]' } });
    guardedTest(AT, f.io);
    expect([...f.files.keys()]).toEqual(['/git/workflow-skips/tree-of-abc123.json']);
  });
});

it('skips bites: a key test that skips on a missing env var fails the check, and passes again with the env var back', () => {
  let env = 'set';
  const run = () => {
    const f = fakeIo({ now: recorded(env === 'set' ? 'base' : 'now'), cached: { '/git/workflow-skips/tree-of-abc123.json': JSON.stringify([TODO]) } });
    return guardedTest({ ...AT, cwd: RAN_IN }, { ...f.io, report: () => recorded(env === 'set' ? 'base' : 'now') }).exitCode;
  };
  const result = proveItBites({ run, inject: () => void (env = 'missing'), revert: () => void (env = 'set'), gate: 'four-checks' });
  expect(result).toEqual(BITES);
});
