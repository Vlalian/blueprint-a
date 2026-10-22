// Red check: a new or changed test file must fail when run against the base code. A test that
// already passes before the change proves nothing about it. This checks TDD's red-before-green
// with code; all five source flows left it to the model. Granularity is the test file (v1). A
// round that adds no test at all fails too (gate.ts, ticket 35).

import { relative } from 'node:path';

export interface RedFinding {
  file: string;
  detail: string;
}

// No exit status (killed or timed out, given as -1), or the shell's "cannot execute" (126) and
// "command not found" (127), or cmd.exe's on Windows (9009, "is not recognized as an internal or
// external command"): the test command never ran, so the failure says nothing about the test.
const NEVER_RAN = new Set([126, 127, 9009]);
const couldNotRun = (exit: number) => exit < 0 || NEVER_RAN.has(exit);

/** Vitest/Jest JSON evidence: a failed assertion, rather than a suite load or configuration error. */
export function reportedFailure(stdout: string | null, file: string): boolean {
  try {
    const report = JSON.parse(String(stdout)) as { testResults: Array<{ name: string; assertionResults: Array<{ status: string }> }> };
    return report.testResults.some((suite) => typeof suite.name === 'string' && relative(file, suite.name) === '' && suite.assertionResults.some((test) => test.status === 'failed'));
  } catch {
    return false;
  }
}

/** The process status and its assertion evidence kept together for the gate. */
export const redRunResult = (run: { status: number | null; stdout: string | null }, file: string) => ({ exitCode: run.status ?? -1, failedTest: reportedFailure(run.stdout, file) });

/**
 * The test command with one file appended as a single literal argument for the shell
 * spawnSync({ shell: true }) starts: sh on POSIX, cmd.exe on Windows. Unquoted, a file named
 * `a$(x).test.ts` ran `x` (review #26). In sh, single quotes are literal and a quote inside is
 * closed, escaped and reopened. In cmd.exe, double quotes keep & | < > ^ and spaces literal, and
 * a Windows file name cannot hold a double quote; but cmd expands %VAR% inside quotes too, so each
 * % steps out of them as ^%: the name between two is then `"x"^`, which no variable has.
 */
export function testCommandLine(command: string, file: string, platform: string): string {
  const quoted = platform === 'win32' ? `"${file.replaceAll('%', '"^%"')}"` : `'${file.replaceAll("'", "'\\''")}'`;
  return `${command} ${quoted}`;
}

export function redCheck(changedTests: string[], exitAtBase: Record<string, number>, allowed: string[], failedAtBase: Record<string, boolean> = {}): RedFinding[] {
  return changedTests
    .filter((file) => !allowed.includes(file))
    .flatMap((file) => {
      const exit = exitAtBase[file];
      if (exit === undefined) return [{ file, detail: 'was not run against the base code' }];
      if (couldNotRun(exit)) return [{ file, detail: `could not run against the base code (exit ${exit}); a test that never ran is not red` }];
      if (exit === 0) return [{ file, detail: 'passes on the base code, so it does not prove the change' }];
      if (failedAtBase[file] !== true) return [{ file, detail: 'no failed test was reported against the base code' }];
      return [];
    });
}
