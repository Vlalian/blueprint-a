import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

// Long enough for jscpd's defaults (5 lines, 50 tokens).
const body = (name: string) => `export function ${name}(xs: number[]): number {
  let total = 0;
  for (const x of xs) {
    if (x > 10) total += x * 2;
    else if (x < -10) total -= x * 3;
    else total -= x;
  }
  return total + xs.length * 3 - 7;
}
`;

function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'duplication-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  mkdirSync(join(dir, 'src'));
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  git('add', '-A');
  git('commit', '-qm', 'base');
  return dir;
}

const run = (dir: string) => spawnSync(process.execPath, [CLI, '--base', 'HEAD', '--cwd', dir], { encoding: 'utf8' });

describe('duplication CLI', () => {
  it('bites: clean passes, a copied block fails, removing the copy passes', () => {
    const dir = repo({ 'src/a.ts': body('a') });
    expect(
      proveItBites({
        run: () => run(dir).status ?? -1,
        inject: () => writeFileSync(join(dir, 'src/b.ts'), body('b')),
        revert: () => rmSync(join(dir, 'src/b.ts')),
      }),
    ).toEqual(BITES);
  });

  it('names the clone the change is part of, and leaves no report behind in the tree', () => {
    const dir = repo({ 'src/a.ts': body('a') });
    writeFileSync(join(dir, 'src/b.ts'), body('b'));
    const r = run(dir);
    expect(r.status).toBe(1);
    const clone = JSON.parse(r.stdout).clones[0];
    expect([clone.first.file, clone.second.file].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe('?? src/b.ts\n');
  });

  it('passes a change next to a clone that was already there', () => {
    const dir = repo({ 'src/a.ts': body('a'), 'src/b.ts': body('b') });
    writeFileSync(join(dir, 'src/c.ts'), 'export const c = 1;\n');
    expect(run(dir).status).toBe(0);
  });

  it('exits 2 when it cannot run (no --base, or a ref that does not exist)', () => {
    const dir = repo({ 'src/a.ts': body('a') });
    expect(spawnSync(process.execPath, [CLI, '--cwd', dir]).status).toBe(2);
    expect(spawnSync(process.execPath, [CLI, '--base', 'nope', '--cwd', dir]).status).toBe(2);
  });

  it('exits 2 on an unknown option rather than ignoring it', () => {
    const r = spawnSync(process.execPath, [CLI, '--bse', 'main'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'duplication', error: expect.stringMatching(/Unknown option '--bse'/) });
  });
});
