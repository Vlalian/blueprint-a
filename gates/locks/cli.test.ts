import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const ROOT = resolve(import.meta.dirname, '../..');

/** The gate as it travels (ticket 72): gates/locks, the consent core and gates/lib only, no scripts/ or hook. */
function install(home: string) {
  mkdirSync(join(home, 'gates', 'lib'), { recursive: true });
  for (const gate of ['locks', 'consent']) cpSync(join(ROOT, 'gates', gate), join(home, 'gates', gate), { recursive: true });
  for (const f of ['contract.ts', 'glob.ts']) cpSync(join(ROOT, 'gates', 'lib', f), join(home, 'gates', 'lib', f));
  writeFileSync(join(home, 'package.json'), '{"type":"module"}');
}

it('allows a foreign project when the installed gate is copied outside git (the mutation sandbox)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locks-cli-'));
  const home = join(dir, 'workflow');
  const project = join(dir, 'project');
  install(home);
  mkdirSync(project);
  const init = spawnSync('git', ['init', '-q'], { cwd: project, encoding: 'utf8' });
  expect(init.status, init.stderr).toBe(0);
  const result = spawnSync(process.execPath, [join(home, 'gates', 'locks', 'cli.ts'), '--staged'], { cwd: project, encoding: 'utf8' });
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ gate: 'locks', pass: true });
});

it('authorizes a changed locked file on detached HEAD only with an agreed --branch ref', () => {
  const home = mkdtempSync(join(tmpdir(), 'locks-detached-'));
  install(home);
  mkdirSync(join(home, 'config'));
  mkdirSync(join(home, 'docs', 'tickets'), { recursive: true });
  expect(spawnSync('git', ['init', '-q'], { cwd: home }).status).toBe(0);
  const tree = spawnSync('git', ['hash-object', '-w', '-t', 'tree', '--stdin'], { cwd: home, input: '', encoding: 'utf8' });
  expect(tree.status, tree.stderr).toBe(0);
  const commit = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@localhost', 'commit-tree', tree.stdout.trim(), '-m', 'fixture'], { cwd: home, encoding: 'utf8' });
  expect(commit.status, commit.stderr).toBe(0);
  writeFileSync(join(home, '.git', 'HEAD'), `${commit.stdout.trim()}\n`);
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd: home, encoding: 'utf8' });
  expect(branch.status, branch.stderr).toBe(0);
  expect(branch.stdout.trim()).toBe('');
  writeFileSync(join(home, 'config', 'locks.json'), '["gates/changed.ts"]');
  writeFileSync(join(home, 'config', 'locks.lock'), '{}');
  writeFileSync(join(home, 'gates', 'changed.ts'), 'changed');
  writeFileSync(join(home, 'config', 'consent.json'), '{"owner":"Ada","tickets":"docs/tickets"}');
  writeFileSync(join(home, 'docs', 'tickets', '67-x.md'), '# Ticket\n\nAgreed: 2026-10-07 (Ada: "build this")\n');
  const cli = join(home, 'gates', 'locks', 'cli.ts');
  const allowed = spawnSync(process.execPath, [cli, '--branch', 'origin/ticket/67-x'], { cwd: home, encoding: 'utf8' });
  expect(allowed.status, allowed.stderr + allowed.stdout).toBe(0);
  expect(JSON.parse(allowed.stdout)).toEqual({ gate: 'locks', pass: true, changed: ['gates/changed.ts'] });
  const denied = spawnSync(process.execPath, [cli], { cwd: home, encoding: 'utf8' });
  expect(denied.status, denied.stderr + denied.stdout).toBe(1);
  expect(JSON.parse(denied.stdout)).toEqual({ gate: 'locks', pass: false, changed: ['gates/changed.ts'] });
  const relocked = spawnSync(process.execPath, [cli, '--relock'], { cwd: home, encoding: 'utf8' });
  expect(relocked.status, relocked.stderr + relocked.stdout).toBe(0);
  const clean = spawnSync(process.execPath, [cli], { cwd: home, encoding: 'utf8' });
  expect(JSON.parse(clean.stdout)).toEqual({ gate: 'locks', pass: true, changed: [] });
});

it('checks the index with the default lock list when the repo has no config/locks.json (review of 72)', () => {
  const home = mkdtempSync(join(tmpdir(), 'locks-default-'));
  install(home);
  mkdirSync(join(home, 'config'));
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@localhost', ...args], { cwd: home, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  };
  git('init', '-q');
  const cli = join(home, 'gates', 'locks', 'cli.ts');
  const relocked = spawnSync(process.execPath, [cli, '--relock'], { cwd: home, encoding: 'utf8' });
  expect(relocked.status, relocked.stderr + relocked.stdout).toBe(0);
  git('add', '.');
  const staged = spawnSync(process.execPath, [cli, '--staged'], { cwd: home, encoding: 'utf8' });
  expect(staged.status, staged.stderr + staged.stdout).toBe(0);
  expect(JSON.parse(staged.stdout)).toEqual({ gate: 'locks', pass: true, changed: [] });
});
