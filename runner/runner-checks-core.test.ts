import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runnerChecks, type RunnerChecksIo } from './runner-checks-core.ts';

const ROOT = join('/repo');
const CONFIG = { checks: { lint: 'npm run lint', test: 'npm test' }, alwaysRun: ['test'], envFile: '.env.ci' };

/** A repo whose tree is `tree`, its files in memory, and a runner that fails the commands in `failing`. */
function fake(opts: { tree?: string | undefined; config?: object; env?: string; failing?: string[] } = {}) {
  const files = new Map<string, string>([[join(ROOT, 'config', 'runner.json'), JSON.stringify(opts.config ?? CONFIG)]]);
  if (opts.env !== undefined) files.set(join(ROOT, '.env.ci'), opts.env);
  const ran: { command: string; env: Record<string, string> }[] = [];
  let t = 0;
  const io: RunnerChecksIo = {
    root: ROOT,
    project: 'shop',
    run: (command, cwd, env) => (ran.push({ command, env }), { exitCode: opts.failing?.includes(command) ? 1 : 0, output: `${command} in ${cwd}` }),
    read: (path) => files.get(path),
    write: (path, text) => void files.set(path, text),
    tree: () => ('tree' in opts ? opts.tree : 'tree1'),
    ms: () => (t += 500),
  };
  return { io, files, ran };
}

const ENV = { WORKFLOW_STATE_DIR: join('/state') };
const CACHE = join('/state', 'check-cache', 'shop');

describe('runnerChecks — the configured checks, with the check-tree cache (ticket 83)', () => {
  it('runs every configured check in the root with the env file, and stores the passing ones under the tree', () => {
    const g = fake({ env: 'TOKEN=abc\n' });
    const r = runnerChecks([], ENV, g.io);
    expect(r).toMatchObject({ gate: 'runner-checks', pass: true, tree: 'tree1' });
    expect(r.results.map((x) => [x.name, x.source])).toEqual([['lint', 'ran'], ['test', 'ran']]);
    expect(g.ran).toEqual([{ command: 'npm run lint', env: { TOKEN: 'abc' } }, { command: 'npm test', env: { TOKEN: 'abc' } }]);
    expect([...g.files.keys()]).toContain(posix.join(CACHE, 'tree1.json'));
  });

  it('Pass when: a check that passed on an unchanged tree with the same command and env file is reused, not run', () => {
    const g = fake({ env: 'TOKEN=abc\n' });
    runnerChecks([], ENV, g.io);
    g.ran.length = 0;
    const again = runnerChecks([], ENV, g.io);
    expect(again.results.map((x) => [x.name, x.source])).toEqual([['lint', 'cached'], ['test', 'ran']]);
    expect(g.ran.map((x) => x.command)).toEqual(['npm test']);
    expect(again.results[0]).toMatchObject({ exitCode: 0, savedMs: 500 });
  });

  it('runs a check again on a changed tree, command or env file', () => {
    const g = fake({ env: 'TOKEN=abc\n' });
    runnerChecks([], ENV, g.io);
    const tree = fake({ env: 'TOKEN=abc\n', tree: 'tree2' });
    for (const [k, v] of g.files) tree.files.set(k, v);
    expect(runnerChecks(['--only', 'lint'], ENV, tree.io).results[0].source).toBe('ran');
    const command = fake({ env: 'TOKEN=abc\n', config: { ...CONFIG, checks: { lint: 'npm run lint -- --fix' } } });
    for (const [k, v] of g.files) if (k.startsWith(CACHE)) command.files.set(k, v);
    expect(runnerChecks([], ENV, command.io).results[0].source).toBe('ran');
    const envFile = fake({ env: 'TOKEN=xyz\n' });
    for (const [k, v] of g.files) if (k.startsWith(CACHE)) envFile.files.set(k, v);
    expect(runnerChecks(['--only', 'lint'], ENV, envFile.io).results[0].source).toBe('ran');
  });

  it('never stores a failing check, and fails the run', () => {
    const g = fake({ failing: ['npm run lint'] });
    expect(runnerChecks(['--only', 'lint'], ENV, g.io).pass).toBe(false);
    expect(runnerChecks(['--only', 'lint'], ENV, g.io).results[0].source).toBe('ran');
    expect(g.ran).toHaveLength(2);
  });

  it('caches nothing when git cannot name the tree, and keeps one cache per project', () => {
    const g = fake({ tree: undefined });
    runnerChecks([], ENV, g.io);
    expect(runnerChecks([], ENV, g.io).results.every((x) => x.source === 'ran')).toBe(true);
    const h = fake();
    h.io.project = 'other';
    runnerChecks([], ENV, h.io);
    expect([...h.files.keys()]).toContain(posix.join(join('/state', 'check-cache', 'other'), 'tree1.json'));
  });

  it('runs with no env file when the config names none, and keeps the cache in the configured state folder', () => {
    const g = fake({ config: { checks: { lint: 'x' }, stateDir: 'runs' } });
    // The root itself reads as a file here: with no env file named, nothing is read from it.
    g.files.set(ROOT, 'SHOULD=not\n');
    runnerChecks([], {}, g.io);
    expect(g.ran).toEqual([{ command: 'x', env: {} }]);
    expect([...g.files.keys()]).toContain(posix.join(join(ROOT, 'runs', 'check-cache', 'shop'), 'tree1.json'));
  });

  it('refuses a check name the config does not have, and a run with no checks', () => {
    expect(() => runnerChecks(['--only', 'lint', '--only', 'nope'], ENV, fake().io)).toThrow('config/runner.json has no check named nope');
    expect(() => runnerChecks(['--only', 'no', '--only', 'nope'], ENV, fake().io)).toThrow('config/runner.json has no check named no, nope');
    expect(runnerChecks([], ENV, fake({ config: {} }).io)).toMatchObject({ gate: 'runner-checks', pass: false, error: 'no checks configured; refusing to pass' });
  });

  it('refuses a flag it does not know', () => {
    expect(() => runnerChecks(['--bogus'], ENV, fake().io)).toThrow();
  });
});
