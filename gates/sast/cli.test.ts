import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sastCli } from './gate.ts';
import { realSastIo, SAST_RULES } from './io.ts';

// Each test spawns git, node or Semgrep: slow under load on Windows.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repo with one commit, then a changed file in the worktree. */
function repo(changed: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sast-cli-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  for (const [file, text] of Object.entries(changed)) {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, ...file.split('/')), text);
  }
  return dir;
}

// A folder with git and nothing else. git's own folder is no Semgrep-free PATH: /usr/bin or
// Homebrew's bin can hold Semgrep beside git. On POSIX a link to git; on Windows Git's cmd folder
// (git.exe there is a launcher that finds Git by its own path, so it cannot be linked or copied),
// which holds only Git's own programs.
function gitOnly(): string {
  const where = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]!;
  // Git for Windows: its cmd folder holds only git's launchers; `where git` may find mingw64\bin first,
  // which holds a hundred other programs.
  if (process.platform === 'win32') return join(spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim(), '..', '..', '..', 'cmd');
  const dir = mkdtempSync(join(tmpdir(), 'git-only-'));
  dirs.push(dir);
  symlinkSync(where, join(dir, 'git'));
  return dir;
}

// The environment with a PATH that has git but no Semgrep. Windows names the variable Path, so
// every spelling of it is replaced.
const noSemgrep = (): NodeJS.ProcessEnv => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  return { ...env, PATH: gitOnly() };
};

const run = (args: string[], env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });

describe('sast CLI', () => {
  it("tests a missing Semgrep on a PATH holding git's programs alone, not all of git's folder", () => {
    const path = noSemgrep().PATH!;
    // Git for Windows's cmd folder: git.exe, gitk.exe, git-gui.exe, start-ssh-agent.cmd and the like.
    // Linux: a folder holding a link to git alone. Windows: Git's cmd folder (git's launchers plus a few
    // tools such as scalar and tig), since a link needs admin rights there; what matters is no Semgrep.
    const others = readdirSync(path).filter((f) => !/^(?:git|start-ssh)/i.test(f));
    if (process.platform === 'win32') expect(others.filter((f) => /semgrep/i.test(f))).toEqual([]);
    else expect(others).toEqual([]);
    expect(spawnSync('git', ['--version'], { env: { PATH: path } }).status).toBe(0);
  });

  it('passes a change with no source file for the rules, without needing Semgrep', () => {
    const dir = repo({ 'notes.md': 'y' });
    const r = run(['--base', 'HEAD', '--cwd', dir], noSemgrep());
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'sast', pass: true, scanned: [] });
  });

  it('exits 2 with the install hint when Semgrep is missing, and writes that result to --json too', () => {
    const dir = repo({ 'src/a.ts': 'export const a = 1;\n' });
    const out = join(dir, 'out', 'sast.json');
    const r = run(['--base', 'HEAD', '--cwd', dir, '--json', out], noSemgrep());
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatch(/Semgrep is not installed or not on PATH.*pip install semgrep==1\.179\.0/);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(JSON.parse(r.stdout));
  });

  it('exits 2 with the usage without --base', () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatch(/^usage: node gates\/sast\/cli.ts --base <ref>/);
  });

  it('with --cwd a subfolder, scans the changed files there and reads their base, all on one path base', () => {
    const dir = repo({});
    const sub = join(dir, 'pkg');
    mkdirSync(join(sub, 'src'), { recursive: true });
    writeFileSync(join(sub, 'src', 'a.ts'), 'export const a = 1;\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'pkg'], { cwd: dir });
    writeFileSync(join(sub, 'src', 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(sub, 'src', 'new file.ts'), 'export const b = 1;\n');
    const calls: { args: string[]; at: string }[] = [];
    const based: string[] = [];
    const real = realSastIo(sub);
    const io = { ...real, semgrep: (args: string[], at: string) => (calls.push({ args, at }), { status: 0, stdout: '{"version":"1.179.0","results":[],"errors":[]}' }), write: (path: string, text: string) => void based.push(text) };
    const r = sastCli(['--base', 'HEAD', '--cwd', sub], { rules: SAST_RULES }, () => io);
    expect(r).toMatchObject({ pass: true, scanned: ['src/a.ts', 'src/new file.ts'] });
    expect(calls.map((c) => c.args.slice(-2))).toEqual([['src/a.ts', 'src/new file.ts'], ['--', 'src/a.ts']]);
    expect(based).toEqual(['export const a = 1;\n']);
  });

  it('runs the pinned rules beside it', () => {
    expect(readFileSync(join(SAST_RULES, 'SNAPSHOT.json'), 'utf8')).toMatch(/"semgrep": "1\.179\.0"/);
  });
});
