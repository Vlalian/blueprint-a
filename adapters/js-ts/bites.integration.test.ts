// Prove the CRAP and mutation gates bite through the JS/TS adapter with real tools: vitest for
// coverage and Stryker for mutants, on a copy of the sample project. Slow (minutes); run with
// `npm run test:integration`. The Angular-style Jest proof is in the Blueprint A export
// (adapters/js-ts/angular.integration.test.ts there).

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'test-strength', 'cli.ts');
let work = '';

const STRONG_TESTS = `import { expect, it } from 'vitest';
import { isEven } from '../../src/is-even.ts';

it('3 is odd', () => {
  expect(isEven(3)).toBe(false);
});

it('4 is even', () => {
  expect(isEven(4)).toBe(true);
});
`;

const BRANCHY = `export function grade(n: number): string {
  if (n > 90) return 'A';
  if (n > 75) return 'B';
  return n > 50 ? 'C' : 'F';
}
`;

const GRADE_TESTS = `import { expect, it } from 'vitest';
import { grade } from '../../src/grade.ts';

it.each([
  [91, 'A'],
  [90, 'B'],
  [76, 'B'],
  [75, 'C'],
  [51, 'C'],
  [50, 'F'],
])('grade(%i) is %s', (n, expected) => {
  expect(grade(n)).toBe(expected);
});
`;

// The child must not inherit this run's own vitest environment: the nested vitest and Stryker
// would otherwise run in a different mode.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'));

function gate(name: 'crap' | 'mutation', file: string): number {
  const r = spawnSync(process.execPath, [CLI, name, '--runner', 'vitest', '--cwd', work, file], { encoding: 'utf8', env: cleanEnv });
  if (r.status !== 0 && r.status !== 1) throw new Error(`test-strength ${name} could not run:\n${r.stdout}\n${r.stderr}`);
  return r.status;
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'js-ts-bites-'));
  cpSync(join(ROOT, 'fixtures', 'sample-project'), work, { recursive: true });
  // Stryker links a real node_modules folder into its sandbox but skips one that is itself a
  // link, so build a real folder of links to every package this repo has.
  const modules = join(work, 'node_modules');
  mkdirSync(modules);
  for (const entry of readdirSync(join(ROOT, 'node_modules'), { withFileTypes: true })) {
    if (entry.isDirectory()) symlinkSync(join(ROOT, 'node_modules', entry.name), join(modules, entry.name), 'junction');
  }
  writeFileSync(join(work, 'tests', 'protected', 'is-even.test.ts'), STRONG_TESTS);
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('the test-strength gates bite through the JS/TS adapter (vitest, real Stryker)', () => {
  it('mutation: fails on a surviving mutant and passes once the test that kills it is back', () => {
    const testFile = join(work, 'tests', 'protected', 'is-even.test.ts');
    const result = proveItBites({
      gate: 'test-strength',
      run: () => gate('mutation', 'src/is-even.ts'),
      // Without the "4 is even" test, `n % 2 === 0` -> `n * 2 === 0` survives.
      inject: () => writeFileSync(testFile, STRONG_TESTS.replace(/\nit\('4 is even'[\s\S]*$/, '\n')),
      revert: () => writeFileSync(testFile, STRONG_TESTS),
    });
    expect(result).toEqual(BITES);
  });

  it('crap: fails an untested branchy function and passes once its tests are back', () => {
    const tests = join(work, 'tests', 'protected', 'grade.test.ts');
    writeFileSync(join(work, 'src', 'grade.ts'), BRANCHY);
    writeFileSync(tests, GRADE_TESTS);
    const result = proveItBites({
      gate: 'test-strength',
      run: () => gate('crap', 'src/grade.ts'),
      // Untested, complexity 4 scores 4^2 + 4 = 20, over the ceiling of 6.
      inject: () => rmSync(tests),
      revert: () => writeFileSync(tests, GRADE_TESTS),
    });
    expect(result).toEqual(BITES);
  });
});
