import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

function repo(report: object, withFile: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  mkdirSync(join(dir, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'evidence', '14.json'), JSON.stringify(report));
  if (withFile) writeFileSync(join(dir, 'docs', 'evidence', '14.png'), 'png');
  return dir;
}

const REPORT = { claim: 'C.', evidence: 'docs/evidence/14.png', kind: 'screenshot', capturedAt: '2026-10-04T10:00:00Z', observed: 'Fits.', verdict: 'pass' };
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('evidence CLI', () => {
  it('exits 0 for a valid report whose file exists, reading both relative to --repo', () => {
    const dir = repo(REPORT, true);
    const r = run('--report', 'docs/evidence/14.json', '--repo', dir, '--claim', 'C.');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'evidence', pass: true });
  });

  it('exits 1 when the evidence file is missing', () => {
    const r = run('--report', 'docs/evidence/14.json', '--repo', repo(REPORT, false));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).problems).toEqual(['the evidence file docs/evidence/14.png does not exist']);
  });

  it('exits 2 when the report cannot be read or no --report is given', () => {
    expect(run('--report', 'no/such.json', '--repo', repo(REPORT, true)).status).toBe(2);
    expect(run().status).toBe(2);
  });

  it('checks a walk report with --walk: exit 1 for an item without evidence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-walk-'));
    const walk = { kind: 'ticket', ticket: '1', url: 'http://x', head: 'a'.repeat(40), patchId: 'b'.repeat(40), startedAt: '2026-10-04T10:00:00Z', viewport: '1280x800', video: 'v.webm', stills: ['1.png', '2.png', '3.png'], items: [{ id: 'A', source: 'qa', claim: 'C.', status: 'fail', observed: 'Broken.', evidence: [] }], extras: { console: [], pageErrors: [], network5xx: [], axe: [] } };
    writeFileSync(join(dir, 'walk.json'), JSON.stringify(walk));
    const r = run('--walk', 'walk.json', '--repo', dir);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).problems).toEqual(['item A (fail) cites no video timestamp or screenshot']);
  });
});
