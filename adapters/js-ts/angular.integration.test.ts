// The Angular check (ticket 20): an Angular-style TypeScript service tested with Jest and ts-jest
// (fixtures/angular-style) proves the CRAP and mutation gates bite through the JS/TS adapter with
// real tools: Jest for coverage, Stryker's Jest runner for mutants. Slow (minutes); run with
// `npm run test:integration`.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'gates', 'test-strength', 'cli.ts');
let work = '';

const SPEC = `import { describe, expect, it } from '@jest/globals';
import { PriceService } from './price.service';

describe('PriceService', () => {
  const service = new PriceService();

  it('adds 25% VAT by default, rounded to cents', () => {
    expect(service.withVat(10)).toBe(12.5);
    expect(service.withVat(0.333)).toBe(0.42);
  });

  it('takes another VAT rate', () => {
    expect(new PriceService(0.1).withVat(10)).toBe(11);
  });

  it('calls a zero price free', () => {
    expect(service.isFree(0)).toBe(true);
  });

  it('calls any other price not free', () => {
    expect(service.isFree(1)).toBe(false);
    expect(service.isFree(-1)).toBe(false);
  });
});
`;

const BRANCHY = `export function discountBand(total: number): string {
  if (total > 1000) return 'gold';
  if (total > 500) return 'silver';
  return total > 100 ? 'bronze' : 'none';
}
`;

const BRANCHY_SPEC = `import { expect, it } from '@jest/globals';
import { discountBand } from './discount';

it.each([
  [1001, 'gold'],
  [1000, 'silver'],
  [501, 'silver'],
  [500, 'bronze'],
  [101, 'bronze'],
  [100, 'none'],
])('discountBand(%i) is %s', (total, band) => {
  expect(discountBand(total)).toBe(band);
});
`;

// The child must not inherit this run's own vitest environment.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'));

function gate(name: 'crap' | 'mutation', file: string): number {
  const r = spawnSync(process.execPath, [CLI, name, '--runner', 'jest', '--cwd', work, file], { encoding: 'utf8', env: cleanEnv });
  if (r.status !== 0 && r.status !== 1) throw new Error(`test-strength ${name} could not run:\n${r.stdout}\n${r.stderr}`);
  return r.status;
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'angular-style-'));
  cpSync(join(import.meta.dirname, 'fixtures', 'angular-style'), work, { recursive: true });
  // Stryker links a real node_modules folder into its sandbox but skips one that is itself a
  // link, so build a real folder of links to every package this package installed.
  const modules = join(work, 'node_modules');
  mkdirSync(modules);
  for (const entry of readdirSync(join(ROOT, 'node_modules'), { withFileTypes: true })) {
    if (entry.isDirectory()) symlinkSync(join(ROOT, 'node_modules', entry.name), join(modules, entry.name), 'junction');
  }
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('Angular-style service with Jest: the test-strength gates bite through the JS/TS adapter', () => {
  it('mutation: fails when the test that kills a mutant is gone, passes once it is back', () => {
    const spec = join(work, 'src', 'app', 'price.service.spec.ts');
    const result = proveItBites({
      gate: 'test-strength',
      run: () => gate('mutation', 'src/app/price.service.ts'),
      // Without "any other price not free", `price === 0` -> `true` survives.
      inject: () => writeFileSync(spec, SPEC.replace(/\n {2}it\('calls any other price not free'[\s\S]*?\n {2}\}\);\n/, '\n')),
      revert: () => writeFileSync(spec, SPEC),
    });
    expect(result).toEqual(BITES);
  });

  it('crap: fails an untested branchy function, passes once its spec is back', () => {
    const spec = join(work, 'src', 'app', 'discount.spec.ts');
    writeFileSync(join(work, 'src', 'app', 'discount.ts'), BRANCHY);
    writeFileSync(spec, BRANCHY_SPEC);
    const result = proveItBites({
      gate: 'test-strength',
      run: () => gate('crap', 'src/app/discount.ts'),
      // Untested, complexity 4 scores 4^2 + 4 = 20, over the ceiling of 6.
      inject: () => rmSync(spec),
      revert: () => writeFileSync(spec, BRANCHY_SPEC),
    });
    expect(result).toEqual(BITES);
  });
});
