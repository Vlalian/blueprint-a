import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { realSastIo } from '../../gates/sast/io.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pythonIo, realToolchain } from './io.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock('node:child_process', async (load) => {
  const real = await load<typeof import('node:child_process')>();
  return { ...real, spawnSync: (...args: Parameters<typeof spawnSync>) => {
    const [command, toolArgs, options] = args;
    const cwd = String(options?.cwd);
    if (command === 'workflow-python-test') {
      if (options?.encoding !== 'utf8' || options.env?.PYTHONUTF8 !== '1') return { status: 1, stdout: '', stderr: 'expected UTF-8' };
      return { status: 0, stdout: `${join(cwd, 'chosen-python')}\n${join(cwd, 'scripts')}\n3.14.0\n`, stderr: '' };
    }
    if (command === join(cwd, 'scripts', process.platform === 'win32' ? 'bandit.exe' : 'bandit')) {
      return { status: 0, stdout: toolArgs?.[0] === '--version' ? 'bandit 1.9.4\n' : options?.env?.WORKFLOW_TEST_VALUE, stderr: '' };
    }
    return real.spawnSync(...args);
  } };
});

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'python-io-'));
  dirs.push(dir);
  for (const f of files) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), '');
  }
  return dir;
}

describe('pythonIo', () => {
  it('uses the selected interpreter and runs its tool with the project environment', () => {
    const dir = project(['scripts/bandit', 'scripts/bandit.exe']);
    vi.stubEnv('WORKFLOW_PYTHON', 'workflow-python-test');
    const tools = realToolchain(dir);
    expect(tools.python()).toBe(join(dir, 'chosen-python'));
    expect(tools.run('bandit', ['-f', 'json'], { WORKFLOW_TEST_VALUE: 'project setting' })).toEqual({
      status: 0, stdout: 'project setting', stderr: '',
    });
  });

  it('gets changed lines relative to the project checkout and includes untracked files', () => {
    const dir = project(['new.py']);
    expect(spawnSync('git', ['init', '-q'], { cwd: dir }).status).toBe(0);
    const base = spawnSync('git', ['mktree'], { cwd: dir, input: '', encoding: 'utf8' });
    expect(base.status).toBe(0);
    expect(pythonIo(dir).changedLines(base.stdout.trim())).toEqual([{ file: 'new.py', line: 1, text: '' }]);
  });
  it('lists the .py files under a folder in order, leaving virtual environments, caches and other files out', () => {
    const dir = project(['src/a.py', 'src/a/c.py', 'src/notes.txt', 'src/.venv/x.py', 'src/venv/y.py', 'src/__pycache__/z.py', 'src/node_modules/w.py', 'src/.git/x.py', 'src/not.py.txt']);
    expect(pythonIo(dir).pyFiles(join(dir, 'src'))).toEqual([join(dir, 'src', 'a.py'), join(dir, 'src', 'a', 'c.py')]);
  });

  it('gives a file as itself', () => {
    const dir = project(['src/b.py']);
    expect(pythonIo(dir).pyFiles(join(dir, 'src', 'b.py'))).toEqual([join(dir, 'src', 'b.py')]);
  });

  it('writes, reads and removes in a temp folder', () => {
    const io = pythonIo(project([]));
    const tmp = io.tempDir();
    expect(tmp.startsWith(join(tmpdir(), 'test-strength-python-'))).toBe(true);
    io.write(join(tmp, 'a.txt'), 'æøå');
    expect(io.read(join(tmp, 'a.txt'))).toBe('æøå');
    io.remove(tmp);
    expect(() => io.read(join(tmp, 'a.txt'))).toThrow();
    expect(() => io.remove(tmp)).not.toThrow();
  });
});

it('returns the Bandit tool output through the SAST I/O', () => {
  const dir = project(['scripts/bandit', 'scripts/bandit.exe']);
  vi.stubEnv('WORKFLOW_PYTHON', 'workflow-python-test');
  expect(realSastIo(dir).bandit(['--version'])).toEqual({ status: 0, stdout: 'bandit 1.9.4\n', stderr: '' });
});
