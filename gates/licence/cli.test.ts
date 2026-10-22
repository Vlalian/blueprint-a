import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('licence CLI', () => {
  it('exits 2 with a usage error and JSON on stdout when no package is given', () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'licence', pass: false, error: expect.stringMatching(/^usage: licence/) });
  });

  it('exits 2 for a name that is not an npm package name, without running npm', () => {
    const r = run('--package', 'x & echo hi=github.com/x');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toBe('not an npm package name: "x & echo hi"');
  });

  it('exits 2 on an unknown option rather than ignoring it', () => {
    const r = run('--pakage', 'a=b');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'licence', error: expect.stringMatching(/Unknown option '--pakage'/) });
  });
});
