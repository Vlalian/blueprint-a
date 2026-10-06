// Property tests (fast-check, named `*.property.test.ts`) run with every `npm test`, but onkel
// never measures with them. Their inputs are random, so a mutant one of them kills today can
// survive tomorrow, and the coverage they add changes from run to run. The verdict has to come
// from the example tests alone: they are left out of the coverage run (which CRAP is scored on)
// and out of Stryker's sandbox (cli.ts, SANDBOX_IGNORE).

export const PROPERTY_TESTS = '**/*.property.test.ts';

export const isPropertyTest = (path: string) => path.endsWith('.property.test.ts');

/** The vitest arguments onkel collects coverage with, property tests left out. */
export function coverageArgs(reportsDir: string): string[] {
  return [
    'run',
    '--exclude',
    PROPERTY_TESTS,
    '--coverage.enabled',
    '--coverage.provider=v8',
    '--coverage.reporter=json',
    `--coverage.reportsDirectory=${reportsDir}`,
  ];
}
