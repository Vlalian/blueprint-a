// Prove onkel bites with real tools: a real Stryker and vitest run over a copy of the fixture
// project. Slow (minutes); run with `npm run test:integration`.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const WORK = join(ROOT, 'state', 'tmp', `onkel-bites-${process.pid}`);
const ONKEL = join(ROOT, 'gates', 'onkel', 'run.ts');

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

// The child must not inherit this test run's own vitest environment (VITEST, NODE_ENV=test,
// worker ids): the nested vitest and Stryker would otherwise run in a different mode.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'),
);

const onkel = (file: string) =>
  spawnSync(process.execPath, [ONKEL, '--whole-file', file], { cwd: WORK, encoding: 'utf8', env: cleanEnv });

beforeAll(() => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'state', 'tmp'), { recursive: true });
  cpSync(join(ROOT, 'fixtures', 'sample-project'), WORK, { recursive: true });
  // The fixture has no node_modules of its own. Stryker links a real node_modules folder into
  // its sandbox but skips one that is itself a junction, so build a real folder of junctions.
  const modules = join(WORK, 'node_modules');
  mkdirSync(modules);
  for (const entry of readdirSync(join(ROOT, 'node_modules'), { withFileTypes: true })) {
    if (entry.isDirectory()) symlinkSync(join(ROOT, 'node_modules', entry.name), join(modules, entry.name), 'junction');
  }
  writeFileSync(join(WORK, 'tests', 'protected', 'is-even.test.ts'), STRONG_TESTS);
});

afterAll(() => rmSync(WORK, { recursive: true, force: true }));

describe('onkel bites (real Stryker)', () => {
  it('fails on a surviving mutant and passes again once the test that kills it is back', () => {
    const testFile = join(WORK, 'tests', 'protected', 'is-even.test.ts');
    const result = proveItBites({
      run: () => {
        const r = onkel('src/is-even.ts');
        if (r.status === 2 || r.status === null) throw new Error(`onkel could not run:\n${r.stdout}\n${r.stderr}`);
        return r.status;
      },
      // Without the "4 is even" test, `n % 2 === 0` -> `n * 2 === 0` survives.
      inject: () => writeFileSync(testFile, STRONG_TESTS.replace(/\nit\('4 is even'[\s\S]*$/, '\n')),
      revert: () => writeFileSync(testFile, STRONG_TESTS),
    });
    expect(result).toEqual(BITES);
  });

  it('fails on a CRAP breach and passes again once the branchy function is tested again', () => {
    const tests = join(WORK, 'tests', 'protected', 'grade.test.ts');
    writeFileSync(join(WORK, 'src', 'grade.ts'), BRANCHY);
    writeFileSync(tests, GRADE_TESTS);
    let lastOutput = '';
    const result = proveItBites({
      run: () => {
        const r = onkel('src/grade.ts');
        lastOutput = r.stdout;
        if (r.status === 2 || r.status === null) throw new Error(`onkel could not run:\n${r.stdout}\n${r.stderr}`);
        return r.status;
      },
      // Untested, complexity 4 scores 4² + 4 = 20, far over the ceiling of 6.
      inject: () => rmSync(tests),
      revert: () => writeFileSync(tests, GRADE_TESTS),
    });
    expect(result).toEqual(BITES);
    expect(lastOutput).toContain('PASS');
  });

  it('names the CRAP breach when the branchy function is untested', () => {
    writeFileSync(join(WORK, 'src', 'grade.ts'), BRANCHY);
    rmSync(join(WORK, 'tests', 'protected', 'grade.test.ts'), { force: true });
    const r = onkel('src/grade.ts');
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/\[crap\] src\/grade\.ts:1 grade/);
    // Decision #40: no Stryker run once CRAP has already failed.
    expect(r.stdout).toContain('mutation skipped: CRAP failed first');
  });

  it('fails on a file-level Stryker disable, though every mutant under it is dealt with, and passes once it is gone (decision #28)', () => {
    const source = join(WORK, 'src', 'is-even.ts');
    const original = readFileSync(source, 'utf8');
    let lastOutput = '';
    const result = proveItBites({
      run: () => {
        const r = onkel('src/is-even.ts');
        lastOutput = r.stdout;
        if (r.status === 2 || r.status === null) throw new Error(`onkel could not run:\n${r.stdout}\n${r.stderr}`);
        return r.status;
      },
      // With a reason, so the old gate took Stryker's reason for an explained suppression and passed.
      inject: () => writeFileSync(source, `// Stryker disable all: generated code\n${original}`),
      revert: () => writeFileSync(source, original),
    });
    expect(result).toEqual(BITES);
    expect(lastOutput).toContain('PASS');
    writeFileSync(source, `// Stryker disable all: generated code\n${original}`);
    try {
      expect(onkel('src/is-even.ts').stdout).toContain('[broad-suppression] src/is-even.ts:1 (directive) — Stryker disable all');
    } finally {
      writeFileSync(source, original);
    }
  });

  it('cannot run (exit 2) on a named .ts path that does not exist (decision #37)', () => {
    const r = onkel('src/is-evn.ts');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('src/is-evn.ts does not exist and the diff does not delete it');
  });
});
