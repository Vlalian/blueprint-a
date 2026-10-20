// Prove the CRAP and mutation gates bite through the .NET adapter with real tools: `dotnet test`
// with coverlet for coverage and Stryker.NET for mutants, on a copy of fixtures/dotnet-sample (a
// class library and an xUnit test project). Slow (minutes); run with `npm run test:integration`.
// Needs the .NET SDK 8 or later on PATH and NuGet to restore the sample's packages and its
// Stryker.NET tool; without dotnet the bites are skipped with that message, and the missing
// toolchain is proven to exit 2 either way.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'test-strength', 'cli.ts');
const SAMPLE = join(ROOT, 'fixtures', 'dotnet-sample');
const HAS_DOTNET = spawnSync('dotnet', ['--version'], { encoding: 'utf8' }).status === 0;
const NO_DOTNET = 'skipped: no dotnet on PATH; install the .NET SDK 8 or later (https://dotnet.microsoft.com/download) to run these';
let work = '';

// The child must not inherit this run's own vitest environment.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'));

function gate(name: 'crap' | 'mutation', file: string): number {
  const r = spawnSync(process.execPath, [CLI, name, '--runner', 'dotnet', '--cwd', work, file], { encoding: 'utf8', env: cleanEnv });
  if (r.status !== 0 && r.status !== 1) throw new Error(`test-strength ${name} could not run:\n${r.stdout}\n${r.stderr}`);
  return r.status;
}

describe('the .NET toolchain', () => {
  it('missing: the gate exits 2 and says what to install, never a pass', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dotnet-missing-'));
    try {
      const env = { ...cleanEnv, PATH: empty, Path: empty };
      const r = spawnSync(process.execPath, [CLI, 'crap', '--runner', 'dotnet', '--cwd', SAMPLE, 'src/Sample/Grades.cs'], { encoding: 'utf8', env });
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout)).toMatchObject({ pass: false, error: expect.stringContaining('install the .NET SDK 8 or later') });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!HAS_DOTNET)(`the test-strength gates bite through the .NET adapter (dotnet test + coverlet, Stryker.NET)${HAS_DOTNET ? '' : ` (${NO_DOTNET})`}`, () => {
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'dotnet-bites-'));
    cpSync(SAMPLE, work, { recursive: true, filter: (src) => !/[\\/](bin|obj|TestResults|StrykerOutput)$/.test(src) });
    const restored = spawnSync('dotnet', ['tool', 'restore'], { cwd: work, encoding: 'utf8', env: cleanEnv });
    if (restored.status !== 0) throw new Error(`dotnet tool restore failed:\n${restored.stdout}\n${restored.stderr}`);
  });

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('mutation: fails on a surviving mutant and passes once the test that kills it is back', () => {
    const tests = join(work, 'tests', 'Sample.Tests', 'ParityTests.cs');
    const strong = readFileSync(tests, 'utf8');
    const result = proveItBites({
      gate: 'test-strength',
      run: () => gate('mutation', 'src/Sample/Parity.cs'),
      // Without FourIsEven, `n % 2 == 0` -> `n * 2 == 0` survives: 3 is odd either way.
      inject: () => writeFileSync(tests, strong.replace(/\n\s*\[Fact\]\s*\n\s*public void FourIsEven[^\n]*\n/, '\n')),
      revert: () => writeFileSync(tests, strong),
    });
    expect(result).toEqual(BITES);
  });

  it('crap: fails an untested branchy method and passes once its tests are back', () => {
    const tests = join(work, 'tests', 'Sample.Tests', 'GradesTests.cs');
    const kept = readFileSync(tests, 'utf8');
    const result = proveItBites({
      gate: 'test-strength',
      run: () => gate('crap', 'src/Sample/Grades.cs'),
      // Untested, complexity 4 scores 4^2 + 4 = 20, over the ceiling of 6.
      inject: () => rmSync(tests),
      revert: () => writeFileSync(tests, kept),
    });
    expect(result).toEqual(BITES);
  });
});
