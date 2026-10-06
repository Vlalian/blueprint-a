import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { existsInRepo } from './repo-path.ts';

describe('existsInRepo (#46)', () => {
  // A fake file system: each known path and what it resolves to; anything else is missing.
  const root = resolve('repo');
  const real = new Map([
    [root, root],
    [join(root, 'src', 'a.ts'), join(root, 'src', 'a.ts')],
    [join(root, 'link', 'secret.md'), resolve('outside', 'secret.md')],
    [join(root, 'sibling.md'), `${root}x${sep}sibling.md`],
  ]);
  const realpath = (p: string) => {
    const hit = real.get(p);
    if (hit === undefined) throw new Error(`ENOENT: ${p}`);
    return hit;
  };

  it('finds a file inside the repo', () => {
    expect(existsInRepo(root, 'src/a.ts', realpath)).toBe(true);
  });

  it('does not find a missing file', () => {
    expect(existsInRepo(root, 'src/missing.ts', realpath)).toBe(false);
  });

  it('refuses a file a symlink takes outside the repo, once resolved', () => {
    expect(existsInRepo(root, 'link/secret.md', realpath)).toBe(false);
  });

  it('refuses a sibling folder whose name starts with the repo name', () => {
    expect(existsInRepo(root, 'sibling.md', realpath)).toBe(false);
  });

  it('refuses the repo folder itself', () => {
    expect(existsInRepo(root, '.', realpath)).toBe(false);
  });

  it('resolves the repo too, so a repo reached through a symlink still holds its files', () => {
    const viaLink = resolve('repo-link');
    const linked = (p: string) => (p === viaLink ? root : realpath(p));
    expect(existsInRepo(viaLink, 'src/a.ts', linked)).toBe(true);
  });

  it('works on the real file system, where a junction or symlink leads out of the repo', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'repo-path-')));
    const repo = join(dir, 'repo');
    const outside = join(dir, 'outside');
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(repo, 'src', 'a.ts'), '');
    writeFileSync(join(outside, 'secret.md'), '');
    // A junction needs no privileges on Windows; elsewhere the type is ignored.
    symlinkSync(outside, join(repo, 'link'), 'junction');
    expect(existsInRepo(repo, 'src/a.ts', realpathSync)).toBe(true);
    expect(existsInRepo(repo, 'link/secret.md', realpathSync)).toBe(false);
    expect(existsInRepo(repo, 'src/missing.ts', realpathSync)).toBe(false);
  });
});
