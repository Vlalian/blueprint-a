// Prove the red check bites with real git and vitest over a copy of the fixture project.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const WORK = join(ROOT, 'state', 'tmp', `red-check-${process.pid}`);
const CLI = join(ROOT, 'gates', 'red-check', 'cli.ts');
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'),
);
const run = (...extra: string[]) =>
  spawnSync(process.execPath, [CLI, '--base', 'HEAD', '--cwd', WORK, ...extra], { encoding: 'utf8', env: cleanEnv });

const NEW_TEST = join(WORK, 'tests', 'new', 'four.test.ts');
const PROVING = `import { expect, it } from 'vitest';
import { isEven } from '../../src/is-even.ts';
it('4 is even', () => { expect(isEven(4)).toBe(true); });
`;

beforeAll(() => {
  rmSync(WORK, { recursive: true, force: true });
  cpSync(join(ROOT, 'fixtures', 'sample-project'), WORK, { recursive: true });
  mkdirSync(join(WORK, 'node_modules'));
  for (const e of readdirSync(join(ROOT, 'node_modules'), { withFileTypes: true })) {
    if (e.isDirectory()) symlinkSync(join(ROOT, 'node_modules', e.name), join(WORK, 'node_modules', e.name), 'junction');
  }
  writeFileSync(join(WORK, '.gitignore'), 'node_modules/\n');
  // Base: isEven is wrong (always false), so a test of an even number fails there.
  writeFileSync(join(WORK, 'src', 'is-even.ts'), 'export function isEven(n: number): boolean {\n  return n < 0;\n}\n');
  const g = (...a: string[]) => execFileSync('git', a, { cwd: WORK });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('add', '-A');
  g('commit', '-qm', 'base');
  // The change: the fix plus a new test that proves it.
  writeFileSync(join(WORK, 'src', 'is-even.ts'), 'export function isEven(n: number): boolean {\n  return n % 2 === 0;\n}\n');
  mkdirSync(join(WORK, 'tests', 'new'), { recursive: true });
  writeFileSync(NEW_TEST, PROVING);
});

afterAll(() => rmSync(WORK, { recursive: true, force: true }));

describe('red-check bites (real git + vitest)', () => {
  it('passes a test that fails on the base, fails one that already passes there, passes again when restored', () => {
    const result = proveItBites({
      run: () => run().status ?? -1,
      // isEven(3) is false on the broken base too, so this test proves nothing.
      inject: () => writeFileSync(NEW_TEST, PROVING.replace("isEven(4)).toBe(true)", "isEven(3)).toBe(false)")),
      revert: () => writeFileSync(NEW_TEST, PROVING),
    });
    expect(result).toEqual(BITES);
  });

  it('fails a round that adds no test, and passes again once the failing new test is back (ticket 35)', () => {
    const result = proveItBites({
      run: () => run().status ?? -1,
      inject: () => rmSync(NEW_TEST),
      revert: () => writeFileSync(NEW_TEST, PROVING),
    });
    expect(result).toEqual(BITES);
    rmSync(NEW_TEST);
    expect(JSON.parse(run().stdout)).toMatchObject({ pass: false, tests: [], findings: [{ detail: 'the specifier added no test' }] });
    writeFileSync(NEW_TEST, PROVING);
  });

  it('cleans up its temporary worktree', () => {
    run();
    expect(existsSync(join(WORK, '.red-check')) ? readdirSync(join(WORK, '.red-check')) : []).toEqual([]);
    expect(execFileSync('git', ['worktree', 'list'], { cwd: WORK, encoding: 'utf8' }).trim().split('\n')).toHaveLength(1);
  });

  it('passes a non-proving test the plan allows', () => {
    writeFileSync(NEW_TEST, PROVING.replace("isEven(4)).toBe(true)", "isEven(3)).toBe(false)"));
    expect(run('--allow', 'tests/new/four.test.ts').status).toBe(0);
    writeFileSync(NEW_TEST, PROVING);
  });
});
