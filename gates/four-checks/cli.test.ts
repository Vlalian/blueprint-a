import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

function cli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function config(exitCode: number) {
  const dir = mkdtempSync(join(tmpdir(), 'four-checks-'));
  const path = join(dir, 'project.json');
  writeFileSync(path, JSON.stringify({ checks: { test: `node -e "process.exitCode = (${exitCode})"` } }));
  return { dir, path };
}

describe('four-checks CLI', () => {
  it('prints JSON and exits 0 when green', () => {
    const { dir, path } = config(0);
    const r = cli(['--config', path, '--cwd', dir]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).pass).toBe(true);
  });

  it('exits 1 when red', () => {
    const { dir, path } = config(3);
    expect(cli(['--config', path, '--cwd', dir]).status).toBe(1);
  });

  it('exits 2 with a JSON error when the config is not valid JSON', () => {
    const { dir, path } = config(0);
    writeFileSync(path, '{nope');
    const r = cli(['--config', path, '--cwd', dir]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'four-checks', pass: false });
  });

  it('exits 2 on a usage error', () => {
    const r = cli([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage/);
  });
});
