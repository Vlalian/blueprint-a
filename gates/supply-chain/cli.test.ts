import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const lock = (packages: Record<string, object>) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...packages } });
const CLEAN = lock({ 'node_modules/a': { version: '1.0.0', license: 'MIT' } });

describe('supply-chain CLI', () => {
  it('exits 2 with a usage error and JSON on stdout when no base is given', () => {
    const r = run(tmpdir());
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'supply-chain', pass: false, error: expect.stringMatching(/^usage: supply-chain/) });
  });

  it('exits 2 on an unknown option rather than ignoring it', () => {
    const r = run(tmpdir(), '--bse', 'main');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatch(/Unknown option '--bse'/);
  });

  it('bites: passes a clean lockfile, fails an install script from an unknown package, passes again once it is gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'supply-chain-'));
    const lockfile = join(dir, 'package-lock.json');
    writeFileSync(join(dir, 'base.json'), lock({}));
    writeFileSync(lockfile, CLEAN);
    const exit = () => run(dir, '--base-file', 'base.json').status ?? -1;
    const bites = proveItBites({
      run: exit,
      inject: () => writeFileSync(lockfile, lock({ 'node_modules/a': { version: '1.0.0', license: 'MIT' }, 'node_modules/evil': { version: '1.0.0', license: 'MIT', hasInstallScript: true } })),
      revert: () => writeFileSync(lockfile, CLEAN),
    });
    expect(bites).toEqual(BITES);
  });

  it('reads the base lockfile from a git ref in the current repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'supply-chain-git-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 't');
    git('config', 'user.email', 't@localhost');
    writeFileSync(join(dir, 'package-lock.json'), CLEAN);
    git('add', '-A');
    git('commit', '-qm', 'base');
    writeFileSync(join(dir, 'package-lock.json'), lock({ 'node_modules/a': { version: '1.0.0', license: 'MIT' }, 'node_modules/gpl': { version: '2.0.0', license: 'GPL-3.0' } }));
    const r = run(dir, '--base', 'main');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ pass: false, changed: ['gpl@2.0.0'] });
    expect(run(dir, '--base', 'nope').status).toBe(2);
  });
});
