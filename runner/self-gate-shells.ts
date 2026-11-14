// Process shells in this repo: files that only parse arguments and wire real I/O (git, files,
// processes) into a tested core. Tests reach them through child processes, which mutation
// testing cannot see, so they are exempt from mutation. They are still graded for CRAP, and with
// no in-process coverage that keeps every function in them at complexity 2 or less: any real
// decision has to live in the core beside them.
// Frozen since ticket 56: a new shell declares itself in its own file instead (scripts/shells.ts),
// so two tickets that each add one no longer meet here.
export const SHELLS = [
  'gates/four-checks/cli.ts',
  'gates/test-deletion/cli.ts',
  'gates/red-check/cli.ts',
  'gates/secret-scan/cli.ts',
  'gates/hidden-unicode/cli.ts',
  'gates/plan/cli.ts',
  'gates/duplication/cli.ts',
  'gates/boundaries/cli.ts',
  'gates/hardener/cli.ts',
  'gates/lib/git.ts',
  'scripts/self-gate.ts',
  'gates/ci-on-sha/cli.ts',
  'gates/ci-on-sha/host-io.ts',
  'gates/supply-chain/cli.ts',
  'scripts/check-package.ts',
  'gates/canary/cli.ts',
  'gates/evidence/cli.ts',
  'gates/walk/cli.ts',
  'gates/four-checks/tree.ts',
  'gates/four-checks/skips-cli.ts',
  'gates/debug-leftovers/cli.ts',
  'gates/test-strength/cli.ts',
  'adapters/js-ts/io.ts',
  'scripts/export-blueprint-a.ts',
  'adapters/dotnet/io.ts',
  'adapters/host/fetch-once.ts',
];
