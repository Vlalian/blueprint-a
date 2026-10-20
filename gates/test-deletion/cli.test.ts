import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'test-deletion-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.test.ts'), "it('one', () => {});\nit('two', () => {});\n");
  git('add', '-A');
  git('commit', '-qm', 'base');
  return dir;
}

const run = (dir: string, ...extra: string[]) =>
  spawnSync(process.execPath, [CLI, '--base', 'HEAD', '--cwd', dir, ...extra], { encoding: 'utf8' });

describe('test-deletion CLI', () => {
  it('bites: clean passes, a deleted test case fails, restoring it passes', () => {
    const dir = repo();
    const file = join(dir, 'a.test.ts');
    expect(
      proveItBites({
        run: () => run(dir).status ?? -1,
        inject: () => writeFileSync(file, "it('one', () => {});\n"),
        revert: () => writeFileSync(file, "it('one', () => {});\nit('two', () => {});\n"),
      }),
    ).toEqual(BITES);
  });

  it('fails on a deleted test file and names its tests', () => {
    const dir = repo();
    rmSync(join(dir, 'a.test.ts'));
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).deleted).toEqual([
      { file: 'a.test.ts', title: 'one' },
      { file: 'a.test.ts', title: 'two' },
    ]);
  });

  it('passes a deletion the plan allows', () => {
    const dir = repo();
    rmSync(join(dir, 'a.test.ts'));
    expect(run(dir, '--allow', 'a.test.ts').status).toBe(0);
  });

  it("passes a deletion the plan's Delete section lists with a replacing test on the branch, and fails it once that test is gone (ticket 70)", () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.test.ts'), "it('one', () => {});\n");
    writeFileSync(join(dir, 'plan.md'), 'Plan for: t.md\n\n## Delete\n- Test: a.test.ts::two -> b.test.ts::two\n');
    writeFileSync(join(dir, 'b.test.ts'), "it('two', () => {});\n");
    expect(run(dir, '--plan', 'plan.md').status).toBe(0);
    rmSync(join(dir, 'b.test.ts'));
    const r = run(dir, '--plan', 'plan.md');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).unreplaced[0].reason).toBe('a.test.ts::two is listed under Delete, but its replacing test b.test.ts::two is not on the branch');
  });

  it('exits 2 when it cannot run (no --base, or a ref that does not exist)', () => {
    const dir = repo();
    expect(spawnSync(process.execPath, [CLI, '--cwd', dir]).status).toBe(2);
    expect(spawnSync(process.execPath, [CLI, '--base', 'nope', '--cwd', dir]).status).toBe(2);
    expect(run(dir, '--plan', 'no-such-plan.md').status).toBe(2);
  });
});
