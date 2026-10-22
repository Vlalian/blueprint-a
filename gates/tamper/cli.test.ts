import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { USAGE } from './gate.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

/** A git repo with a config file committed in it: the gate reads a config in the repo at the base. */
function repo(config: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tamper-cli-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'tamper.json'), config);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'config'], { cwd: dir });
  return { dir, config: join(dir, 'tamper.json') };
}

describe('tamper CLI', () => {
  it('exits 2 on an unknown option rather than ignoring it', () => {
    const r = run('--bse', 'HEAD');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'tamper', pass: false, error: expect.stringMatching(/Unknown option '--bse'/) });
  });

  it('exits 2 with the usage without the hooks fingerprint', () => {
    const w = repo('{ "protectedPaths": [] }');
    const r = run('--base', 'HEAD', '--config', w.config, '--cwd', w.dir);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toBe(USAGE);
  });

  it('exits 2 when the base holds no config, whatever the working tree says', () => {
    const w = repo('{ "protectedPaths": [] }');
    writeFileSync(join(w.dir, 'new.json'), '{ "protectedPaths": [] }');
    const r = run('--base', 'HEAD', '--hooks', 'f', '--config', join(w.dir, 'new.json'), '--cwd', w.dir);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatch(/^no tamper config at /);
  });

  it('exits 2 when the config names no protected paths', () => {
    const w = repo('{}');
    const r = run('--base', 'HEAD', '--hooks', 'f', '--config', w.config, '--cwd', w.dir);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatch(/name the protected globs/);
  });
});
