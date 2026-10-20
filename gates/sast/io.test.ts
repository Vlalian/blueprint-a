import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEMGREP, realSastIo } from './io.ts';

// Each test spawns git, node or Semgrep: slow under load on Windows.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const dirs: string[] = [];
const temp = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sast-io-')));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('realSastIo', () => {
  it('runs the command in the folder it is given, with UTF-8 Python, and gives its status and stdout', () => {
    const dir = temp();
    const io = realSastIo(dir, process.execPath);
    const r = io.semgrep(['-e', 'process.stdout.write(process.cwd() + " " + process.env.PYTHONUTF8)'], dir);
    expect(r).toEqual({ status: 0, stdout: `${dir} 1` });
    expect('error' in r).toBe(false);
    expect(io.semgrep(['-e', 'process.exitCode = 7'], dir).status).toBe(7);
  });

  it('takes a scan of many findings: stdout well past a few hundred bytes', () => {
    const dir = temp();
    expect(realSastIo(dir, process.execPath).semgrep(['-e', 'process.stdout.write("x".repeat(5000))'], dir).stdout).toHaveLength(5000);
  });

  it('runs Semgrep by its command name unless told otherwise', () => {
    expect(DEFAULT_SEMGREP).toBe('semgrep');
  });

  it('gives the spawn error of a command that is not there', () => {
    const r = realSastIo(temp(), join(temp(), 'no-semgrep')).semgrep(['--version'], temp());
    expect(r.status).toBeNull();
    expect(r.stdout).toBe('');
    expect((r.error as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('reads a worktree file by its slashed path, and nothing for a missing one', () => {
    const dir = temp();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'x');
    const io = realSastIo(dir);
    expect(io.readHead('src/a.ts')).toBe('x');
    expect(io.readHead('src/b.ts')).toBeUndefined();
  });

  it('writes a file in a new folder, and removes a folder', () => {
    const io = realSastIo(temp());
    const dir = io.tempDir();
    dirs.push(dir);
    expect(dir.startsWith(join(tmpdir(), 'sast-base-'))).toBe(true);
    io.write(join(dir, 'src', 'deep', 'a.ts'), 'y');
    expect(readFileSync(join(dir, 'src', 'deep', 'a.ts'), 'utf8')).toBe('y');
    io.remove(dir);
    expect(existsSync(dir)).toBe(false);
    expect(() => io.remove(dir)).not.toThrow();
  });

  it('runs git in the worktree', () => {
    const dir = temp();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const r = realSastIo(dir).git(['rev-parse', '--show-toplevel']);
    expect(r.status).toBe(0);
    expect(join(r.stdout.trim())).toBe(join(dir));
  });
});
