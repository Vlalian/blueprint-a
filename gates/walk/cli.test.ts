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

/** A repo with a walk report whose one criterion item has the given status, and its media. */
function repo(status: 'pass' | 'fail') {
  const dir = mkdtempSync(join(tmpdir(), 'walk-gate-'));
  mkdirSync(join(dir, '.walk'), { recursive: true });
  for (const f of ['v.webm', '1.png', '2.png', '3.png']) writeFileSync(join(dir, '.walk', f), 'x');
  const report = {
    kind: 'ticket', ticket: '1', url: 'http://127.0.0.1:1', head: HEAD, patchId: PATCH, startedAt: '2026-10-04T10:00:00Z', viewport: '1280x800', video: '.walk/v.webm',
    stills: ['.walk/1.png', '.walk/2.png', '.walk/3.png'],
    items: [{ id: 'AC1', source: 'criterion', claim: 'C.', status, observed: 'Seen.', evidence: [{ screenshot: '.walk/1.png' }] }],
    extras: { console: [], pageErrors: [], network5xx: [], axe: [] },
  };
  writeFileSync(join(dir, '.walk', 'report.json'), JSON.stringify(report));
  return dir;
}

const run = (dir: string, ...extra: string[]) =>
  spawnSync(process.execPath, [CLI, '--report', '.walk/report.json', '--head', HEAD, '--patch-id', PATCH, '--criterion', 'AC1', '--repo', dir, ...extra], { encoding: 'utf8' });

describe('walk gate CLI', () => {
  it('exits 0 when the report holds, is bound to the head and covers every criterion; no replay runs (ticket 95)', () => {
    const r = run(repo('pass'));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'walk', pass: true, problems: [] });
  });

  it('exits 1 on a criterion the walk saw fail', () => {
    const r = run(repo('fail'));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).problems).toEqual(['AC1 failed: Seen.']);
  });

  it('exits 1 on a report bound to another head, or missing an expected criterion', () => {
    expect(run(repo('pass'), '--head', 'c'.repeat(40)).status).toBe(1);
    expect(JSON.parse(run(repo('pass'), '--criterion', 'AC2').stdout).problems).toEqual(['the report has no item AC2']);
  });

  it('exits 2 on an unknown option, the old replay options included, or a report it cannot read', () => {
    expect(run(repo('pass'), '--nope').status).toBe(2);
    expect(run(repo('pass'), '--playwright', 'pw.js').status).toBe(2);
    expect(spawnSync(process.execPath, [CLI, '--report', 'missing.json', '--repo', repo('pass')], { encoding: 'utf8' }).status).toBe(2);
  });
});
