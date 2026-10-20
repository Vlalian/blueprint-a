// The gate contract (gates/lib/contract.ts) for onkel: its verdict passes through as 0 or 1,
// and a crash is 2, "could not run". A crash used to exit 1, which read as an ordinary fail.

export function exitCodeOf(main: () => number): number {
  try {
    return main();
  } catch (e) {
    console.error(`onkel could not run: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

/**
 * Found 2026-10-03: with vitest 5, Stryker 10's vitest runner runs no test inside a `describe`
 * against a runtime mutant, so every such mutant reads as "survived". The gate would escalate
 * on code that is fully tested. Until that is fixed upstream, onkel refuses to run on vitest 5+.
 * (Bisected in this repo: the same tests killed 9/9 at top level and 0/9 inside describe.)
 */
export function toolchainProblem(vitestVersion: string | undefined): string | null {
  if (vitestVersion === undefined) return 'vitest not found in this project; onkel needs it for coverage and mutation';
  const major = Number(vitestVersion.split('.')[0]);
  if (!Number.isInteger(major)) return `cannot read the vitest version "${vitestVersion}"`;
  if (major >= 5) {
    return `vitest ${vitestVersion}: Stryker 10 does not run tests inside describe blocks on vitest 5+, so mutants would falsely survive. Pin vitest ^4.`;
  }
  return null;
}
