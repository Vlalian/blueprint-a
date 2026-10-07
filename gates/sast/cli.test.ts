import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAST_RULES } from './io.ts';

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

// The environment with a PATH that has git but no Semgrep: git's own folder only. Windows names the
// variable Path, so every spelling of it is replaced.
const noSemgrep = (): NodeJS.ProcessEnv => {
  const where = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]!;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  return { ...env, PATH: join(where, '..') };
};

const run = (args: string[], env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });

describe('sast CLI', () => {
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

  it('runs the pinned rules beside it', () => {
    expect(readFileSync(join(SAST_RULES, 'SNAPSHOT.json'), 'utf8')).toMatch(/"semgrep": "1\.179\.0"/);
  });
});
