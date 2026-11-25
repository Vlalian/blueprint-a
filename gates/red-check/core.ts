// Red check: a new or changed test file must fail when run against the base code. A test that
// already passes before the change proves nothing about it. This checks TDD's red-before-green
// with code; all five source flows left it to the model. Granularity is the test file (v1). A
// round that adds no test at all fails too (gate.ts, ticket 35).

import { join, relative } from 'node:path';
import { decode, descendants, parseXml, type Element } from '../lib/xml.ts';

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

/** A pytest test case's dotted module for a test file: tests/test_parity.py is tests.test_parity. */
const dottedModule = (file: string) => file.replace(/\.py$/, '').split('/').join('.');

/** The red check's own JUnit report, written by the test command in the base checkout (--junit); never a path the caller owns. */
export const JUNIT_REPORT = '.red-check-junit.xml';

// What pytest prints when a test file imports a module, or a name from a module, that is not there.
const MISSING = [/ModuleNotFoundError: No module named '([\w.]+)'/g, /ImportError: cannot import name '[\w.]+' from '([\w.]+)'/g];

/** The top-level packages a collection error says are missing something. */
const missingPackages = (text: string) => MISSING.flatMap((re) => [...decode(text).matchAll(re)].map((m) => m[1]!.split('.')[0]!));

/** Whether a test case belongs to the test file: by its file attribute (xunit1), else its classname, the file's dotted module with any class after it (xunit2). */
function ofFile(c: Element, test: string, module: string): boolean {
  if (c.attrs.file !== undefined) return c.attrs.file.split('\\').join('/') === test;
  return c.attrs.classname === module || String(c.attrs.classname).startsWith(`${module}.`);
}

/**
 * Whether the file's collection error (pytest names that test case after the module) is an import
 * of the project's own code that is not written yet: a specifier's test of a module the coder will
 * add. That is red, test-first; any other collection error is not.
 */
function ownImportError(c: Element, module: string, own: ((name: string) => boolean) | undefined): boolean {
  if (own === undefined || c.attrs.name !== module) return false;
  return c.children.some((e) => e.name === 'error' && missingPackages(e.text).some(own));
}

/**
 * pytest's JUnit XML evidence (ticket 99): a failed test case of this file (its project-relative
 * path), or a collection error importing the project's own code (`own` knows its top-level
 * packages). A failure of another file, or another collection error, is not red.
 */
export function junitFailure(xml: string | undefined, test: string, own?: (name: string) => boolean): boolean {
  const module = dottedModule(test);
  const failed = (c: Element) => ofFile(c, test, module) && c.children.some((e) => e.name === 'failure');
  return descendants(parseXml(String(xml)), 'testcase').some((c) => failed(c) || ownImportError(c, module, own));
}

/** Whether a top-level package or module is the project's own: in its src/ folder or at its root. */
export const ownPackage = (root: string, exists: (path: string) => boolean) => (name: string) =>
  ['src', ''].some((dir) => exists(join(root, dir, name)) || exists(join(root, dir, `${name}.py`)));

/** The process status and its assertion evidence kept together for the gate, from the runner's JSON on stdout. */
export const redRunResult = (run: { status: number | null; stdout: string | null }, file: string) => ({ exitCode: run.status ?? -1, failedTest: reportedFailure(run.stdout, file) });

export interface RedRunIo {
  /** Runs a command line in a shell in the folder. */
  run(line: string, dir: string): { status: number | null; stdout: string | null };
  /** The file's text, or undefined when there is none. */
  read(path: string): string | undefined;
}

export interface RedRunOptions {
  command: string;
  /** pytest: hand it --junitxml in the checkout and read that report instead of stdout. */
  junit: boolean;
  platform: string;
  own: (name: string) => boolean;
}

/** Runs one test file in the base checkout and says whether a test of it failed. */
export function runRedTest(opts: RedRunOptions, dir: string, file: string, io: RedRunIo): { exitCode: number; failedTest: boolean } {
  if (!opts.junit) return redRunResult(io.run(testCommandLine(opts.command, file, opts.platform), dir), join(dir, file));
  const report = join(dir, JUNIT_REPORT);
  const command = `${opts.command} ${quoted(`--junitxml=${report}`, opts.platform)}`;
  const ran = io.run(testCommandLine(command, file, opts.platform), dir);
  return { exitCode: ran.status ?? -1, failedTest: junitFailure(io.read(report), file, opts.own) };
}

/**
 * The test command with one file appended as a single literal argument for the shell
 * spawnSync({ shell: true }) starts: sh on POSIX, cmd.exe on Windows. Unquoted, a file named
 * `a$(x).test.ts` ran `x` (review #26). In sh, single quotes are literal and a quote inside is
 * closed, escaped and reopened. In cmd.exe, double quotes keep & | < > ^ and spaces literal, and
 * a Windows file name cannot hold a double quote; but cmd expands %VAR% inside quotes too, so each
 * % steps out of them as ^%: the name between two is then `"x"^`, which no variable has.
 */
export function testCommandLine(command: string, file: string, platform: string): string {
  return `${command} ${quoted(file, platform)}`;
}

/** One literal argument for the shell, as testCommandLine quotes it. */
const quoted = (arg: string, platform: string) => (platform === 'win32' ? `"${arg.replaceAll('%', '"^%"')}"` : `'${arg.replaceAll("'", "'\\''")}'`);

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
