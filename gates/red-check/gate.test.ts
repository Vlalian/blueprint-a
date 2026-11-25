import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { redCheckGate, redCheckProject, type RedCheckIo } from './gate.ts';

it('runs distinct tracked and untracked tests outside .red-check in the base checkout', () => {
  const root = join(process.cwd(), 'project');
  const dir = join(root, '.red-check', 'base-42');
  const gitOutput = new Map([
    ['diff|--name-only|--no-renames|--diff-filter=AM|main|--', 'src/a.py\ntests/test_a.py\ntests/test_c.py\n'],
    ['ls-files|--others|--exclude-standard', 'tests/test_a.py\n.red-check/old.test.ts\ntests/test_b.py\n'],
    ['rev-parse|--git-common-dir', '.git\n'],
    [`worktree|add|--detach|--force|${dir}|main`, ''],
    [`worktree|remove|--force|${dir}`, ''],
  ]);
  const dirs = new Set<string>();
  const runs: Array<{ line: string; at: string }> = [];
  const files = new Map([
    [join(root, 'tests', 'test_a.py'), 'a'],
    [join(root, 'tests', 'test_b.py'), 'b'],
    [join(root, 'tests', 'test_c.py'), 'c'],
  ]);
  const result = redCheckProject({ base: 'main', allow: [], cwd: root, command: 'runner {CWD} {CWD}', junit: false, pid: 42, platform: 'linux' }, {
    git: (...args) => {
      const output = gitOutput.get(args.join('|'));
      if (output === undefined) throw new Error(`unexpected Git command: ${args.join(' ')}`);
      if (args[1] === 'remove') {
        files.delete(join(dir, 'tests', 'test_a.py'));
        files.delete(join(dir, 'tests', 'test_b.py'));
        files.delete(join(dir, 'tests', 'test_c.py'));
      }
      return output;
    },
    exists: (path) => files.has(path),
    read: (path) => files.get(path),
    makeDir: (path) => void dirs.add(path),
    write: (path, text) => void files.set(path, text),
    copy: (from, to) => {
      if (!dirs.has(dirname(to))) throw new Error('missing target folder');
      files.set(to, files.get(from) ?? '');
    },
    run: (line, at) => {
      const rootArg = root.replaceAll('\\', '/');
      runs.push({ line, at });
      const file = /^runner .* 'tests\/(test_[abc]\.py)'$/.exec(line)?.[1];
      const name = join(at, 'tests', file ?? 'missing');
      const failed = file !== undefined && at === dir && line === `runner ${rootArg} ${rootArg} 'tests/${file}'` && files.get(name) === file[5];
      return { status: 1, stdout: JSON.stringify({ testResults: [{ name, assertionResults: [{ status: failed ? 'failed' : 'passed' }] }] }) };
    },
  });
  const rootArg = root.replaceAll('\\', '/');
  expect(runs).toEqual([
    { line: `runner ${rootArg} ${rootArg} 'tests/test_a.py'`, at: dir },
    { line: `runner ${rootArg} ${rootArg} 'tests/test_c.py'`, at: dir },
    { line: `runner ${rootArg} ${rootArg} 'tests/test_b.py'`, at: dir },
  ]);
  expect(result).toEqual({
    gate: 'red-check', base: 'main', pass: true, tests: ['tests/test_a.py', 'tests/test_c.py', 'tests/test_b.py'],
    exitAtBase: { 'tests/test_a.py': 1, 'tests/test_c.py': 1, 'tests/test_b.py': 1 }, findings: [],
  });
  expect(files.get(join(dir, 'tests', 'test_a.py'))).toBeUndefined();
  expect(files.get(join(dir, 'tests', 'test_b.py'))).toBeUndefined();
  expect(files.get(join(dir, 'tests', 'test_c.py'))).toBeUndefined();
  expect(files.get(join(root, '.git', 'info', 'exclude').replaceAll('\\', '/'))).toBe('\n/.red-check/\n');
});

function fakeIo(changed: string[], exits: Record<string, number>) {
  const log: string[] = [];
  const io: RedCheckIo = {
    changedTests: (base) => (log.push(`changed ${base}`), changed),
    checkoutBase: (base) => {
      log.push(`checkout ${base}`);
      return { dir: '/tree', remove: () => log.push('remove') };
    },
    copyInto: (dir, file) => log.push(`copy ${file} -> ${dir}`),
    runTest: (dir, file) => (log.push(`run ${file} in ${dir}`), { exitCode: exits[file] ?? 0, failedTest: true }),
  };
  return { io, log };
}

describe('redCheckGate', () => {
  it('fails without checking out anything when no test is new or changed: the specifier added no test (ticket 35)', () => {
    const { io, log } = fakeIo([], {});
    expect(redCheckGate({ base: 'abc', allow: [] }, io)).toEqual({ gate: 'red-check', pass: false, base: 'abc', tests: [], findings: [{ file: '', detail: 'the specifier added no test' }] });
    expect(log).toEqual(['changed abc']);
  });

  it('copies each changed test into the base checkout, runs it there, and removes the checkout', () => {
    const { io, log } = fakeIo(['a.test.ts'], { 'a.test.ts': 1 });
    const result = redCheckGate({ base: 'abc', allow: [] }, io);
    expect(result).toEqual({
      gate: 'red-check',
      pass: true,
      base: 'abc',
      tests: ['a.test.ts'],
      exitAtBase: { 'a.test.ts': 1 },
      findings: [],
    });
    expect(log).toEqual(['changed abc', 'checkout abc', 'copy a.test.ts -> /tree', 'run a.test.ts in /tree', 'remove']);
  });

  it('fails a test that passes on the base code', () => {
    const { io } = fakeIo(['a.test.ts'], { 'a.test.ts': 0 });
    const result = redCheckGate({ base: 'abc', allow: [] }, io);
    expect(result.pass).toBe(false);
    expect(result.findings).toEqual([{ file: 'a.test.ts', detail: 'passes on the base code, so it does not prove the change' }]);
  });

  it('removes the checkout even when a run throws', () => {
    const { io, log } = fakeIo(['a.test.ts'], {});
    io.runTest = () => {
      throw new Error('spawn failed');
    };
    expect(() => redCheckGate({ base: 'abc', allow: [] }, io)).toThrow('spawn failed');
    expect(log.at(-1)).toBe('remove');
  });

  it('throws a usage error without --base', () => {
    expect(() => redCheckGate({ allow: [] }, fakeIo([], {}).io)).toThrow(/usage: red-check --base/);
  });
});
