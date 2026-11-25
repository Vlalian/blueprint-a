import { describe, expect, it } from 'vitest';
import { JUNIT_REPORT, junitFailure, ownPackage, redRunResult, redCheck, reportedFailure, runRedTest, testCommandLine } from './core.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

it('requires a string suite name and preserves the empty relative path comparison', () => {
  expect(reportedFailure(JSON.stringify({ testResults: [
    { name: 'other.test.ts', assertionResults: [{ status: 'failed' }] },
    { name: 'a.test.ts', assertionResults: [{ status: 'passed' }, { status: 'failed' }] },
  ] }), 'a.test.ts')).toBe(true);
  expect(reportedFailure(JSON.stringify({ testResults: [
    { name: 42, assertionResults: [{ status: 'failed' }] },
    { name: 'a.test.ts', assertionResults: [{ status: 'failed' }] },
  ] }), 'a.test.ts')).toBe(true);
  expect(reportedFailure(JSON.stringify({ testResults: [{ name: '', assertionResults: [{ status: 'failed' }] }] }), '')).toBe(true);
  expect(reportedFailure(JSON.stringify({ testResults: [{ name: 42, assertionResults: [{ status: 'failed' }] }] }), '')).toBe(false);
  expect(testCommandLine('runner', 'a%b%c', 'win32')).toBe('runner "a"^%"b"^%"c"');
});

it('does not count another file\'s failed assertion as proof that the requested test ran', () => {
  const report = JSON.stringify({ testResults: [{ name: join('base', 'other.test.ts'), assertionResults: [{ status: 'failed' }] }] });
  expect(reportedFailure(report, join('base', 'requested.test.ts'))).toBe(false);
});

it('requires process status and failed-test evidence together', () => {
  expect(redRunResult({ status: null, stdout: null }, 'a.test.ts')).toEqual({ exitCode: -1, failedTest: false });
  expect(redRunResult({ status: 1, stdout: '{"testResults":[{"name":"a.test.ts","assertionResults":[{"status":"failed"}]}]}' }, 'a.test.ts')).toEqual({ exitCode: 1, failedTest: true });
});

/** pytest's JUnit XML (`--junitxml`, the xunit2 default) with these test cases. */
const junit = (...cases: string[]) => `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="1" skipped="0" tests="${cases.length}">${cases.join('')}</testsuite></testsuites>`;
const failed = (classname: string, name: string) => `<testcase classname="${classname}" name="${name}" time="0.001"><failure message="assert False">def test(): assert False</failure></testcase>`;
const passed = (classname: string, name: string) => `<testcase classname="${classname}" name="${name}" time="0.001" />`;

describe('junitFailure (pytest, ticket 99)', () => {
  it('finds a failed test case of the file by its dotted module, in a class too', () => {
    expect(junitFailure(junit(failed('tests.test_parity', 'test_four')), 'tests/test_parity.py')).toBe(true);
    expect(junitFailure(junit(failed('tests.test_parity.TestEven', 'test_four')), 'tests/test_parity.py')).toBe(true);
  });

  it("does not count another file's failure, a passing case, a collection error or a missing report", () => {
    expect(junitFailure(junit(failed('tests.test_parity_more', 'test_x')), 'tests/test_parity.py')).toBe(false);
    expect(junitFailure(junit(passed('tests.test_parity', 'test_four')), 'tests/test_parity.py')).toBe(false);
    const collection = '<testcase classname="" name="tests.test_parity" time="0.000"><error message="collection failure">ImportError</error></testcase>';
    expect(junitFailure(junit(collection), 'tests/test_parity.py')).toBe(false);
    expect(junitFailure(undefined, 'tests/test_parity.py')).toBe(false);
    expect(junitFailure('not xml', 'tests/test_parity.py')).toBe(false);
  });

  it.each([
    ['system-out', '<system-out>captured stdout</system-out>'],
    ['skipped', '<skipped message="not available"/>'],
  ])('does not count a testcase with only a %s child as a failure', (_tag, child) => {
    const testcase = `<testcase classname="tests.test_parity" name="test_four">${child}</testcase>`;
    expect(junitFailure(junit(testcase), 'tests/test_parity.py')).toBe(false);
  });

  it('reads the file attribute when the report has one (junit_family=xunit1)', () => {
    const withFile = '<testcase classname="x" file="tests/test_parity.py" name="t"><failure message="m"/></testcase>';
    expect(junitFailure(junit(withFile), 'tests/test_parity.py')).toBe(true);
    expect(junitFailure(junit(withFile.replace('tests/test_parity.py', 'tests\\test_parity.py')), 'tests/test_parity.py')).toBe(true);
    expect(junitFailure(junit(withFile.replace('classname="x"', 'classname="tests.test_other"')), 'tests/test_other.py')).toBe(false);
    expect(junitFailure(junit('<testcase name="x"><failure/></testcase>'), 'tests/test_parity.py')).toBe(false);
  });

  // pytest 9's report for three test files whose imports fail at collection: a module of the
  // project's own package not written yet, a name not yet in one of its modules, and a third-party
  // package that is not installed.
  const COLLECTION = readFileSync(join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'red-check', 'pytest-collection-errors.xml'), 'utf8');
  const own = (name: string) => name === 'sample';

  it("counts a collection error importing the project's own code that is not written yet as red: that is test-first", () => {
    expect(junitFailure(COLLECTION, 'tests/test_sign.py', own)).toBe(true);
    expect(junitFailure(COLLECTION, 'tests/test_odd.py', own)).toBe(true);
  });

  it('keeps every other collection error not red: a missing third-party package, or no own package known', () => {
    expect(junitFailure(COLLECTION, 'tests/test_ext.py', own)).toBe(false);
    expect(junitFailure(COLLECTION, 'tests/test_sign.py')).toBe(false);
  });
});

describe('ownPackage', () => {
  it('knows a top-level package or module in src/ or at the project root', () => {
    const there = new Set([join('/p', 'src', 'sample'), join('/p', 'tools.py'), join('/p', 'src', 'one.py'), join('/p', 'app')]);
    const own = ownPackage('/p', (path) => there.has(path));
    expect(['sample', 'tools', 'one', 'app', 'requests'].map(own)).toEqual([true, true, true, true, false]);
  });
});

describe('runRedTest', () => {
  const dir = join('/repo', '.red-check', 'base-1');
  const report = join(dir, JUNIT_REPORT);

  it("runs the test command on one file and reads the runner's JSON on stdout", () => {
    const lines: string[] = [];
    const run = runRedTest({ command: 'npx vitest run', junit: false, platform: 'linux', own: () => false }, dir, 'a.test.ts', {
      run: (line, at) => (lines.push(`${at}|${line}`), { status: 1, stdout: JSON.stringify({ testResults: [{ name: join(dir, 'a.test.ts'), assertionResults: [{ status: 'failed' }] }] }) }),
      read: () => undefined,
    });
    expect(run).toEqual({ exitCode: 1, failedTest: true });
    expect(lines).toEqual([`${dir}|npx vitest run 'a.test.ts'`]);
  });

  it('with junit, hands pytest a report path of its own in the checkout and reads it there', () => {
    const lines: string[] = [];
    const read: string[] = [];
    const run = runRedTest({ command: 'python -m pytest -q', junit: true, platform: 'linux', own: () => false }, dir, 'tests/test_parity.py', {
      run: (line) => (lines.push(line), { status: 1, stdout: '' }),
      read: (path) => (read.push(path), junit(failed('tests.test_parity', 't'))),
    });
    expect(run).toEqual({ exitCode: 1, failedTest: true });
    expect(lines).toEqual([`python -m pytest -q '--junitxml=${report}' 'tests/test_parity.py'`]);
    expect(read).toEqual([report]);
  });

  it('with junit, reads no report as no failed test', () => {
    const run = runRedTest({ command: 'pytest', junit: true, platform: 'win32', own: () => false }, dir, 'tests/test_a.py', { run: () => ({ status: null, stdout: null }), read: () => undefined });
    expect(run).toEqual({ exitCode: -1, failedTest: false });
  });
});

it('requires a failed assertion in the runner JSON, not a load error or missing report', () => {
  expect(reportedFailure('{"testResults":[{"name":"a.test.ts","assertionResults":[{"status":"failed"}]}]}', 'a.test.ts')).toBe(true);
  for (const text of ['', 'not JSON', '{}', '{"testResults":[{"name":"a.test.ts","assertionResults":[]}]}', '{"testResults":[{"name":"a.test.ts","assertionResults":[{"status":"passed"}]}]}']) expect(reportedFailure(text, 'a.test.ts')).toBe(false);
});

describe('testCommandLine — the file as one literal shell argument (review #26)', () => {
  it('single-quotes the file for sh, closing and escaping a quote inside it', () => {
    expect(testCommandLine('npx vitest run', 'a$(x) b.test.ts', 'linux')).toBe("npx vitest run 'a$(x) b.test.ts'");
    expect(testCommandLine('npx vitest run', "it's.test.ts", 'darwin')).toBe("npx vitest run 'it'\\''s.test.ts'");
  });

  it('double-quotes the file for cmd.exe on Windows', () => {
    expect(testCommandLine('npx vitest run', 'a&b c.test.ts', 'win32')).toBe('npx vitest run "a&b c.test.ts"');
  });

  it('keeps a % literal for cmd.exe, which expands %VAR% even inside double quotes', () => {
    // Each % leaves the quotes as ^%: between two of them the name read is `"PATH"^`, which no
    // variable has, so nothing expands, and the caret then drops out.
    expect(testCommandLine('npx vitest run', 'a%PATH%b.test.ts', 'win32')).toBe('npx vitest run "a"^%"PATH"^%"b.test.ts"');
    expect(testCommandLine('npx vitest run', '100%.test.ts', 'linux')).toBe("npx vitest run '100%.test.ts'");
  });
});

describe('redCheck', () => {
  it('passes when every new or changed test file fails against the base code', () => {
    expect(redCheck(['a.test.ts', 'b.test.ts'], { 'a.test.ts': 1, 'b.test.ts': 1 }, [], { 'a.test.ts': true, 'b.test.ts': true })).toEqual([]);
  });

  it('flags a test file that already passes on the base code: it proves nothing about the change', () => {
    expect(redCheck(['a.test.ts', 'b.test.ts'], { 'a.test.ts': 1, 'b.test.ts': 0 }, [], { 'a.test.ts': true })).toEqual([
      { file: 'b.test.ts', detail: 'passes on the base code, so it does not prove the change' },
    ]);
  });

  it('allows a file the plan lists (a refactor ticket keeps its tests green on purpose)', () => {
    expect(redCheck(['b.test.ts'], { 'b.test.ts': 0 }, ['b.test.ts'])).toEqual([]);
  });

  // 9009: cmd.exe's "is not recognized as an internal or external command", the Windows 127.
  it.each([-1, 126, 127, 9009])('flags a file whose test command could not run at the base (exit %i), instead of counting it red', (exit) => {
    expect(redCheck(['a.test.ts'], { 'a.test.ts': exit }, [])).toEqual([
      { file: 'a.test.ts', detail: `could not run against the base code (exit ${exit}); a test that never ran is not red` },
    ]);
  });

  it.each([1, 2, 125, 128, 9008, 9010])('rejects exit %i without evidence of a failed test', (exit) => {
    expect(redCheck(['a.test.ts'], { 'a.test.ts': exit }, [])).toEqual([{ file: 'a.test.ts', detail: 'no failed test was reported against the base code' }]);
  });

  it('flags a file it has no result for, instead of passing it unchecked', () => {
    expect(redCheck(['c.test.ts'], {}, [])).toEqual([{ file: 'c.test.ts', detail: 'was not run against the base code' }]);
  });
});

it('strips only the final Python suffix when mapping a pytest module to its file', () => {
  expect(junitFailure(junit(failed('pkg.py.test_a', 'test_it')), 'pkg.py/test_a.py')).toBe(true);
});

it('reads mixed JUnit children and accepts an import error for any own package it names', () => {
  const trace = "ModuleNotFoundError: No module named 'third_party' and ModuleNotFoundError: No module named 'project.next'";
  const own = (name: string) => name === 'project';
  const named = '<testcase name="tests.test_a"><system-out/><error>' + trace + '</error></testcase>';
  const logged = '<testcase name="tests.test_a"><system-out>' + trace + '</system-out></testcase>';
  const failedWithLog = '<testcase classname="tests.test_a" name="test_it"><system-out/><failure/></testcase>';
  expect(junitFailure(junit(named), 'tests/test_a.py', own)).toBe(true);
  expect(junitFailure(junit(logged), 'tests/test_a.py', own)).toBe(false);
  expect(junitFailure(junit(failedWithLog), 'tests/test_a.py')).toBe(true);
});

it('reads only the reserved JUnit report written in the base checkout', () => {
  const dir = join('/repo', '.red-check', 'base-1');
  const report = join(dir, '.red-check-junit.xml');
  const documents = new Map<string, string>();
  expect(runRedTest({ command: 'pytest', junit: true, platform: 'linux', own: () => false }, dir, 'tests/test_a.py', {
    run: (line, at) => {
      if (at === dir && line === "pytest '--junitxml=" + report + "' 'tests/test_a.py'") {
        documents.set(report, junit(failed('tests.test_a', 'test_it')));
      }
      return { status: 1, stdout: null };
    },
    read: (path) => documents.get(path),
  })).toEqual({ exitCode: 1, failedTest: true });
});
