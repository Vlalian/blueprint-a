import { describe, expect, it } from 'vitest';
import { redRunResult, redCheck, reportedFailure, testCommandLine } from './core.ts';
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
