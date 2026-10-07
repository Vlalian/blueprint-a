import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'debug-leftovers-'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@localhost']]) git(...args);
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return { dir, git, base: git('rev-parse', 'HEAD') };
}

const cli = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

/** A project.json with this printAllowed list. */
function config(printAllowed?: string[]) {
  const path = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'project.json');
  writeFileSync(path, JSON.stringify({ checks: {}, printAllowed }));
  return path;
}

describe('debug-leftovers CLI', () => {
  it('passes a worktree that adds no debug line, and one that adds it only in a test', () => {
    const { dir, base } = repo();
    expect(cli(['--base', base, '--cwd', dir, '--config', config()]).status).toBe(0);
    writeFileSync(join(dir, 'a.test.ts'), 'console.log(1);\n');
    expect(cli(['--base', base, '--cwd', dir, '--config', config()]).status).toBe(0);
  });

  it('fails a committed and an untracked debug line since the base, naming each, unless the config allows the file', () => {
    const { dir, git, base } = repo();
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\nconsole.log(a);\n');
    git('commit', '-qam', 'log');
    writeFileSync(join(dir, 'b.ts'), 'debugger;\n');
    const r = cli(['--base', base, '--cwd', dir, '--config', config()]);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).found).toEqual([
      { file: 'a.ts', line: 2, text: 'console.log(a);' },
      { file: 'b.ts', line: 1, text: 'debugger;' },
    ]);
    expect(cli(['--base', base, '--cwd', dir, '--config', config(['*.ts'])]).status).toBe(0);
  });

  it('exits 2 when there is no diff against the base, and on a usage error', () => {
    const { dir } = repo();
    expect(cli(['--base', 'no-such-ref', '--cwd', dir, '--config', config()]).status).toBe(2);
    expect(cli(['--config', config()]).stderr).toMatch(/usage: debug-leftovers/);
    expect(cli(['--base', 'x']).status).toBe(2);
    expect(cli(['--base', 'x', '--config', join(dir, 'missing.json')]).status).toBe(2);
  });
});
