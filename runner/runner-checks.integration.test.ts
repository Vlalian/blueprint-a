// Ticket 83's Pass when for the check-tree cache, end to end: scripts/runner-checks.ts in a real
// git repo, with real checks. A check that passed on an unchanged tree with the same command and
// env file is reused; a changed file runs it again.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI = join(import.meta.dirname, 'runner-checks.ts');
// Each test spawns the CLI, which spawns git and node; under load on Windows that is slow.
const SPAWNS = 120_000;

let dir: string;
let repo: string;
const counted = () => (existsSync(join(dir, 'count.txt')) ? readFileSync(join(dir, 'count.txt'), 'utf8').length : 0);
const checks = () => {
  const r = spawnSync(process.execPath, [CLI], { cwd: repo, encoding: 'utf8' });
  return { status: r.status, result: JSON.parse(r.stdout) as { pass: boolean; results: { name: string; source: string }[] } };
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-checks-'));
  repo = join(dir, 'repo');
  mkdirSync(join(repo, 'config'), { recursive: true });
  const git = (...args: string[]) => spawnSync('git', args, { cwd: repo });
  git('init', '-q');
  // The state folder, where the cache lives, is ignored: a cache write must not change the tree.
  writeFileSync(join(repo, '.gitignore'), 'state/\n');
  writeFileSync(join(repo, 'count.cjs'), "require('node:fs').appendFileSync(process.env.COUNT_FILE, 'x');\n");
  writeFileSync(join(repo, '.env.ci'), `COUNT_FILE=${join(dir, 'count.txt')}\n`);
  writeFileSync(join(repo, 'config', 'runner.json'), JSON.stringify({ checks: { count: 'node count.cjs' }, envFile: '.env.ci' }));
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
}, SPAWNS);
afterAll(() => rmSync(dir, { recursive: true, force: true }), SPAWNS);

describe('runner checks on a real tree (ticket 83 Pass when)', () => {
  it('runs a check once, reuses it on the unchanged tree, and runs it again after a change', () => {
    expect(checks()).toMatchObject({ status: 0, result: { pass: true, results: [{ name: 'count', source: 'ran' }] } });
    expect(checks().result.results[0].source).toBe('cached');
    expect(counted()).toBe(1);
    writeFileSync(join(repo, 'a.ts'), 'export const a = 2;\n');
    expect(checks().result.results[0].source).toBe('ran');
    expect(counted()).toBe(2);
  }, SPAWNS);
});
