import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { key, selectFiles, unexplainedMissing } from './select.ts';

// Which files a run grades. Moved out of cli.ts, which is exempt from mutation, so this
// decision is mutation-tested as cli.ts's header always said (review #22).

const all = () => true;

describe('key — the path both coverage and Stryker agree on', () => {
  it('is repo-relative with forward slashes, however the path was written', () => {
    expect(key(join(process.cwd(), 'src', 'a.ts'))).toBe('src/a.ts');
    expect(key('./src/a.ts')).toBe('src/a.ts');
    // A Windows path as Stryker and v8 print it.
    expect(key('src\\app\\a.ts')).toBe('src/app/a.ts');
  });
});

describe('selectFiles — what a run grades and what it skips', () => {
  it('grades source .ts files and skips .tsx, tests and declarations', () => {
    expect(selectFiles(['src/a.ts', 'src/b.tsx', 'src/a.test.ts', 'src/t.d.ts', 'src/c.js'], all)).toEqual({
      files: ['src/a.ts'],
      skipped: ['src/b.tsx', 'src/a.test.ts', 'src/t.d.ts', 'src/c.js'],
      missing: [],
    });
  });

  it('skips a path that is not there, and names a missing source .ts as missing (decision #37)', () => {
    expect(selectFiles(['src/a.ts', 'src/gone.ts'], (p) => p === 'src/a.ts')).toEqual({
      files: ['src/a.ts'],
      skipped: ['src/gone.ts'],
      missing: ['src/gone.ts'],
    });
  });

  it('names as missing only source .ts paths: a missing test, declaration or .tsx is just skipped', () => {
    const none = () => false;
    expect(selectFiles(['src/gone.ts', 'src/gone.test.ts', 'src/gone.d.ts', 'src/gone.tsx'], none).missing).toEqual(['src/gone.ts']);
  });

  it('reads paths, not flags, and keys every path', () => {
    expect(selectFiles(['--whole-file', '--base', 'main', './src/a.ts'], all)).toEqual({ files: ['src/a.ts'], skipped: [], missing: [] });
  });

  it('asks about each path by its key', () => {
    const asked: string[] = [];
    selectFiles(['./src/a.ts'], (p) => (asked.push(p), true));
    expect(asked).toEqual(['src/a.ts']);
  });
});

describe('unexplainedMissing — a named path that is not there is a typo unless the diff deletes it (decision #37)', () => {
  it('names each missing path the diff does not delete, in the order given', () => {
    expect(unexplainedMissing(['src/b.ts', 'src/gone.ts', 'src/a.ts'], ['src/gone.ts'])).toEqual(['src/b.ts', 'src/a.ts']);
  });

  it('names none when the diff deletes every missing path', () => {
    expect(unexplainedMissing(['src/gone.ts'], ['src/other.ts', 'src/gone.ts'])).toEqual([]);
  });
});
