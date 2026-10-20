import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

it('exits 2 when it cannot run: no --base, or a directory that is not a git repo', () => {
  expect(spawnSync(process.execPath, [CLI]).status).toBe(2);
  const notRepo = mkdtempSync(join(tmpdir(), 'red-check-norepo-'));
  expect(spawnSync(process.execPath, [CLI, '--base', 'HEAD', '--cwd', notRepo]).status).toBe(2);
});

/** A repo with one committed test, and a test command that records its arguments and fails (red). */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'red-check-cli-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.test.ts'), 'it("a", () => {});\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  const record = join(dir, '..', `${dir.split(/[\\/]/).pop()}.args`);
  const recorder = join(dir, '..', `${dir.split(/[\\/]/).pop()}.recorder.cjs`);
  writeFileSync(recorder, `require('fs').appendFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)) + '\\n'); process.exitCode = (1);\n`);
  const run = () =>
    spawnSync(process.execPath, [CLI, '--base', 'HEAD', '--cwd', dir, '--test-command', `node "${recorder}"`], { encoding: 'utf8' });
  const recorded = () => readFileSync(record, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
  return { dir, g, run, recorded };
}

it('red-checks a test file that was moved and edited, not only added or modified ones (review #25)', () => {
  const { dir, g, run, recorded } = repo();
  g('mv', 'a.test.ts', 'b.test.ts');
  writeFileSync(join(dir, 'b.test.ts'), 'it("a", () => {});\nit("b", () => {});\n');
  g('add', '-A');
  const r = run();
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(JSON.parse(r.stdout).tests).toEqual(['b.test.ts']);
  expect(recorded()).toEqual([['b.test.ts']]);
});

it('hands the test command a file name as one literal argument, never as shell code (review #26)', () => {
  const { dir, run, recorded } = repo();
  const name = 'a$(echo x)`echo y` b;c.test.ts';
  writeFileSync(join(dir, name), 'it("c", () => {});\n');
  const r = run();
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(recorded()).toEqual([[name]]);
});
