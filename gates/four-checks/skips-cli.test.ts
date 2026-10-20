import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'skips-cli.ts');

// A fake test runner, committed in the repo: it marks every line of skips.txt in the folder it runs
// in as a skipped test of a.test.ts, in vitest's JSON report, and exits with EXIT.
const RUNNER = `const fs = require('fs');
const skipped = fs.readFileSync('skips.txt', 'utf8').split('\\n').filter(Boolean);
const tests = skipped.map((fullName) => ({ fullName, status: 'skipped' })).concat([{ fullName: 'runs', status: 'passed' }]);
fs.writeFileSync('report.json', JSON.stringify({ testResults: [{ name: process.cwd() + '/a.test.ts', assertionResults: tests }] }));
console.log('ran ' + tests.length);
process.exitCode = Number(process.env.EXIT || 0);
`;

const gitIn = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'skips-cli-'));
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@t'], ['config', 'core.autocrlf', 'false']]) gitIn(dir, ...args);
  writeFileSync(join(dir, 'runner.cjs'), RUNNER);
  writeFileSync(join(dir, 'skips.txt'), 'old skip\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-qm', 'base');
  return { dir, base: gitIn(dir, 'rev-parse', 'HEAD') };
}

const cli = (dir: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });

const TEST = ['--report', 'report.json', '--test', 'node "{CWD}/runner.cjs"'];

describe('skips CLI', () => {
  it("passes the test command's output and exit when no more tests skip than at the base, leaving no report or checkout behind", () => {
    const { dir, base } = repo();
    const r = cli(dir, ['--base', base, ...TEST]);
    expect([r.status, r.stdout, r.stderr]).toEqual([0, 'ran 2\n', '']);
    expect(existsSync(join(dir, 'report.json'))).toBe(false);
    expect(gitIn(dir, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(gitIn(dir, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(gitIn(dir, 'rev-parse', '--absolute-git-dir'), 'workflow-skips', `${gitIn(dir, 'rev-parse', 'HEAD^{tree}')}.json`), 'utf8')).toBe('["a.test.ts > old skip"]');
  });

  it('fails a green run with a test skipped that the base ran, naming it, and keeps a red exit code', () => {
    const { dir, base } = repo();
    writeFileSync(join(dir, 'skips.txt'), 'old skip\nsaves to the database\n');
    const r = cli(dir, ['--base', base, '--cwd', dir, ...TEST]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('ran 3\n\nSkipped tests: 2, at the base (' + base + ') 1. A skipped test is not a passing one; these were not skipped at the base:\n- a.test.ts > saves to the database\n');
    expect(cli(dir, ['--base', base, ...TEST], { EXIT: '4' }).status).toBe(4);
  });

  it('exits 2 on a usage error', () => {
    const r = cli(tmpdir(), ['--base', 'x', '--report', 'r.json']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage: skips-cli/);
  });
});
