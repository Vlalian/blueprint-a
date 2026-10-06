import { describe, expect, it } from 'vitest';
import { ALWAYS_RUN, entryKey, runCachedChecks, type CacheIo, type CacheWhere } from './cache.ts';
import type { Runner } from './check.ts';

function fakeIo(tree: string | undefined) {
  const files: Record<string, string> = {};
  let clock = 0;
  const io: CacheIo & { tree: (cwd: string) => string | undefined } = {
    read: (path) => files[path],
    write: (path, text) => void (files[path] = text),
    tree: () => tree,
    ms: () => (clock += 100),
  };
  return { io, files };
}

function counting(exitCodes: Record<string, number> = {}) {
  const ran: string[] = [];
  const run: Runner = (command, cwd) => (ran.push(`${command} @ ${cwd}`), { exitCode: exitCodes[command] ?? 0, output: `out of ${command}\n` });
  return { run, ran };
}

const where: CacheWhere = { dir: '/state/check-cache/sample', envText: 'A=1\n', alwaysRun: [] };
const checks = { lint: 'npm run lint', test: 'npm test' };

describe('runCachedChecks', () => {
  it('runs every check the first time on a tree, each with its ms, and says it ran', () => {
    const { io } = fakeIo('t1');
    const { run, ran } = counting();
    const g = runCachedChecks(checks, run, '/repo', where, io);
    expect(ran).toEqual(['npm run lint @ /repo', 'npm test @ /repo']);
    expect(g).toEqual({
      gate: 'four-checks',
      pass: true,
      tree: 't1',
      results: [
        { name: 'lint', command: 'npm run lint', exitCode: 0, tail: 'out of npm run lint', source: 'ran', ms: 100 },
        { name: 'test', command: 'npm test', exitCode: 0, tail: 'out of npm test', source: 'ran', ms: 100 },
      ],
    });
  });

  it('reuses the passing results on the same tree, with the ms they saved, and runs nothing', () => {
    const { io } = fakeIo('t1');
    const first = counting();
    runCachedChecks(checks, first.run, '/repo', where, io);
    const again = counting();
    const g = runCachedChecks(checks, again.run, '/repo', where, io);
    expect(again.ran).toEqual([]);
    expect(g.pass).toBe(true);
    expect(g.results[0]).toEqual({ name: 'lint', command: 'npm run lint', exitCode: 0, tail: 'out of npm run lint', source: 'cached', ms: 0, savedMs: 100 });
  });

  it('keeps the results under state/check-cache/<project>/<tree>.json', () => {
    const { io, files } = fakeIo('t1');
    runCachedChecks({ lint: 'l' }, counting().run, '/repo', where, io);
    expect(JSON.parse(files['/state/check-cache/sample/t1.json']!)).toEqual({ [entryKey('lint', 'l', 'A=1\n')]: { tail: 'out of l', ms: 100 } });
  });

  it('never caches a failing check: it runs again on the same tree', () => {
    const { io, files } = fakeIo('t1');
    const failing = counting({ 'npm test': 1 });
    expect(runCachedChecks(checks, failing.run, '/repo', where, io).pass).toBe(false);
    const again = counting({ 'npm test': 1 });
    const g = runCachedChecks(checks, again.run, '/repo', where, io);
    expect(again.ran).toEqual(['npm test @ /repo']);
    expect(g.results.map((r) => [r.name, r.source, r.exitCode])).toEqual([
      ['lint', 'cached', 0],
      ['test', 'ran', 1],
    ]);
    expect(Object.keys(JSON.parse(files['/state/check-cache/sample/t1.json']!))).toHaveLength(1);
  });

  it('writes nothing when every check came from the cache or failed', () => {
    const { io, files } = fakeIo('t1');
    runCachedChecks({ test: 't' }, counting({ t: 1 }).run, '/repo', where, io);
    expect(files).toEqual({});
  });

  it('re-runs on a changed tree, a changed command or a changed env file', () => {
    const { io } = fakeIo('t1');
    runCachedChecks(checks, counting().run, '/repo', where, io);
    const changed = (w: CacheWhere, c: Record<string, string>, t: string) => {
      const { run, ran } = counting();
      runCachedChecks(c, run, '/repo', w, { ...io, tree: () => t });
      return ran.length;
    };
    expect(changed(where, checks, 't2')).toBe(2);
    expect(changed(where, { ...checks, test: 'npm test -- --run' }, 't1')).toBe(1);
    expect(changed({ ...where, envText: 'A=2\n' }, checks, 't1')).toBe(2);
    expect(changed({ ...where, envText: undefined }, checks, 't1')).toBe(2);
  });

  it('reads no env file as an empty one', () => {
    const { io } = fakeIo('t1');
    runCachedChecks(checks, counting().run, '/repo', { ...where, envText: undefined }, io);
    const again = counting();
    runCachedChecks(checks, again.run, '/repo', { ...where, envText: '' }, io);
    expect(again.ran).toEqual([]);
  });

  it('always runs the tamper check when the project marks none', () => {
    const { io } = fakeIo('t1');
    const w = { dir: where.dir, envText: '' };
    runCachedChecks({ tamper: 'tm' }, counting().run, '/repo', w, io);
    const again = counting();
    runCachedChecks({ tamper: 'tm' }, again.run, '/repo', w, io);
    expect(again.ran).toEqual(['tm @ /repo']);
  });

  it('never shares results across projects', () => {
    const { io } = fakeIo('t1');
    runCachedChecks(checks, counting().run, '/repo', where, io);
    const other = counting();
    runCachedChecks(checks, other.run, '/repo', { ...where, dir: '/state/check-cache/other' }, io);
    expect(other.ran).toHaveLength(2);
  });

  it('keys an entry by check name too, so two names with one command are two entries', () => {
    expect(entryKey('a', 'x', '')).not.toBe(entryKey('b', 'x', ''));
    expect(entryKey('a', 'x', '')).not.toBe(entryKey('a', 'x', 'E=1'));
    expect(entryKey('a', 'x', '')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('always runs a check marked alwaysRun, and the tamper check, and never stores them', () => {
    const { io, files } = fakeIo('t1');
    const w = { ...where, alwaysRun: ['e2e'] };
    const c = { e2e: 'e', tamper: 'tm', lint: 'l' };
    runCachedChecks(c, counting().run, '/repo', w, io);
    const again = counting();
    const g = runCachedChecks(c, again.run, '/repo', w, io);
    expect(again.ran).toEqual(['e @ /repo', 'tm @ /repo']);
    expect(g.results.map((r) => r.source)).toEqual(['ran', 'ran', 'cached']);
    expect(Object.keys(JSON.parse(files['/state/check-cache/sample/t1.json']!))).toHaveLength(1);
    expect(ALWAYS_RUN).toEqual(['tamper']);
  });

  it('caches nothing without a project folder, and asks git for no tree', () => {
    const { io, files } = fakeIo('t1');
    let asked = 0;
    const w = { ...where, dir: undefined };
    const counted = { ...io, tree: () => (asked++, 't1') };
    runCachedChecks(checks, counting().run, '/repo', w, counted);
    const again = counting();
    const g = runCachedChecks(checks, again.run, '/repo', w, counted);
    expect(again.ran).toHaveLength(2);
    expect(asked).toBe(0);
    expect(files).toEqual({});
    expect(g.tree).toBeUndefined();
  });

  it('caches nothing when git names no tree', () => {
    const { io, files } = fakeIo(undefined);
    runCachedChecks(checks, counting().run, '/repo', where, io);
    const again = counting();
    runCachedChecks(checks, again.run, '/repo', where, io);
    expect(again.ran).toHaveLength(2);
    expect(files).toEqual({});
  });

  it('asks git for the tree of the folder the checks run in', () => {
    const { io } = fakeIo('t1');
    const seen: string[] = [];
    runCachedChecks(checks, counting().run, '/repo', where, { ...io, tree: (cwd) => (seen.push(cwd), 't1') });
    expect(seen).toEqual(['/repo']);
  });

  it('refuses to pass with no checks configured, as the plain gate does', () => {
    const { io } = fakeIo('t1');
    expect(runCachedChecks({}, counting().run, '/repo', where, io)).toEqual({ gate: 'four-checks', pass: false, results: [], error: 'no checks configured; refusing to pass' });
  });

  it('reads a cache file that is not JSON as empty, and runs the checks', () => {
    const { io, files } = fakeIo('t1');
    files['/state/check-cache/sample/t1.json'] = '{cut off';
    const again = counting();
    runCachedChecks(checks, again.run, '/repo', where, io);
    expect(again.ran).toHaveLength(2);
    expect(Object.keys(JSON.parse(files['/state/check-cache/sample/t1.json']!))).toHaveLength(2);
  });
});
