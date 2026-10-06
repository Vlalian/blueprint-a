import { describe, expect, it } from 'vitest';
import { coverageArgs, isPropertyTest, PROPERTY_TESTS } from './property-tests.ts';
import { SANDBOX_IGNORE } from './cli.ts';

describe('property tests are kept out of measurement', () => {
  it('names property tests by their suffix, at any depth', () => {
    expect(PROPERTY_TESTS).toBe('**/*.property.test.ts');
    expect(isPropertyTest('tests/hardener/clamp.property.test.ts')).toBe(true);
    expect(isPropertyTest('gates/hardener/core.property.test.ts')).toBe(true);
    expect(isPropertyTest('tests/hardener/clamp.test.ts')).toBe(false);
    expect(isPropertyTest('src/property.test.ts.bak')).toBe(false);
  });

  it('leaves them out of the coverage run, which is what CRAP is scored on', () => {
    expect(coverageArgs('/tmp/cov')).toEqual([
      'run',
      '--exclude',
      PROPERTY_TESTS,
      '--coverage.enabled',
      '--coverage.provider=v8',
      '--coverage.reporter=json',
      '--coverage.reportsDirectory=/tmp/cov',
    ]);
  });

  it('leaves them out of the Stryker sandbox, so no mutant counts as killed by one', () => {
    expect(SANDBOX_IGNORE).toContain(PROPERTY_TESTS);
    expect(SANDBOX_IGNORE).toEqual(['.claude', '.next', PROPERTY_TESTS]);
  });
});
