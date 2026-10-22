import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('review-schema CLI', () => {
  it('exits 0 for a valid review and 1 for a malformed one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-schema-'));
    writeFileSync(join(dir, 'good.json'), '{"findings": []}');
    writeFileSync(join(dir, 'bad.json'), '{"findings": [{}]');
    expect(run('--output', join(dir, 'good.json'), '--exit-code', '0').status).toBe(0);
    const bad = run('--output', join(dir, 'bad.json'), '--exit-code', '0');
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).errors[0]).toMatch(/not JSON/);
  });

  it('exits 1 when the output file does not exist: a reviewer that wrote nothing blocks', () => {
    expect(run('--output', join(tmpdir(), 'no-such-review.json'), '--exit-code', '0').status).toBe(1);
  });

  it('exits 2 without arguments', () => {
    expect(run().status).toBe(2);
  });

  it('exits 2 on an unknown option rather than ignoring it', () => {
    const r = run('--outptu', 'x.json', '--exit-code', '0');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'review-schema', error: expect.stringMatching(/Unknown option '--outptu'/) });
  });
});
