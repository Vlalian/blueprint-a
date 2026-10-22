import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// Spawns processes: the Windows load rule (ticket 29) gives every test and hook 60 s.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');
const HEAD = 'a'.repeat(40);
const PATCH = 'b'.repeat(40);

/** A repo with a walk report, its media, and a stand-in for the app's Playwright that exits as told and says what it got. */
function repo(exitCode: number) {
  const dir = mkdtempSync(join(tmpdir(), 'walk-gate-'));
  mkdirSync(join(dir, '.walk'), { recursive: true });
  for (const f of ['v.webm', '1.png', '2.png', '3.png']) writeFileSync(join(dir, '.walk', f), 'x');
  const report = {
    kind: 'ticket', ticket: '1', url: 'http://127.0.0.1:1', head: HEAD, patchId: PATCH, startedAt: '2026-10-04T10:00:00Z', viewport: '1280x800', video: '.walk/v.webm',
    stills: ['.walk/1.png', '.walk/2.png', '.walk/3.png'],
    items: [{ id: 'AC1', source: 'criterion', claim: 'C.', status: 'pass', observed: 'Holds.', evidence: [{ screenshot: '.walk/1.png' }] }],
    extras: { console: [], pageErrors: [], network5xx: [], axe: [] },
  };
  writeFileSync(join(dir, '.walk', 'report.json'), JSON.stringify(report));
  writeFileSync(join(dir, 'pw.js'), `process.stdout.write(JSON.stringify({ args: process.argv.slice(2), base: process.env.WALK_BASE_URL })); process.exitCode = ${exitCode};\n`);
  return dir;
}

const run = (dir: string, ...extra: string[]) =>
  spawnSync(process.execPath, [CLI, '--report', '.walk/report.json', '--head', HEAD, '--patch-id', PATCH, '--spec', 'tests/walk/1.spec.ts', '--criterion', 'AC1', '--playwright', 'pw.js', '--base-url', 'http://127.0.0.1:1', '--repo', dir, ...extra], { encoding: 'utf8' });

describe('walk gate CLI', () => {
  it('exits 0 when the report holds and the pinned spec re-runs green, run with 2 retries against the base URL', () => {
    const r = run(repo(0));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'walk', pass: true, problems: [] });
  });

  it('exits 1 and quotes the run when the pinned spec fails', () => {
    const r = run(repo(1));
    expect(r.status).toBe(1);
    const problem = JSON.parse(r.stdout).problems[0] as string;
    expect(JSON.parse(problem.slice('the pinned specs failed after 2 retries: '.length))).toEqual({
      args: ['test', 'tests/walk/1.spec.ts', '--retries=2', '--trace=on-first-retry', '--reporter=line'],
      base: 'http://127.0.0.1:1',
    });
  });

  it('exits 2 on an unknown option or a report it cannot read', () => {
    expect(run(repo(0), '--nope').status).toBe(2);
    expect(spawnSync(process.execPath, [CLI, '--report', 'missing.json', '--repo', repo(0)], { encoding: 'utf8' }).status).toBe(2);
  });
});
