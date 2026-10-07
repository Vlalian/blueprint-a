import { describe, expect, it } from 'vitest';
import { redCheck, testCommandLine } from './core.ts';

describe('testCommandLine — the file as one literal shell argument (review #26)', () => {
  it('single-quotes the file for sh, closing and escaping a quote inside it', () => {
    expect(testCommandLine('npx vitest run', 'a$(x) b.test.ts', 'linux')).toBe("npx vitest run 'a$(x) b.test.ts'");
    expect(testCommandLine('npx vitest run', "it's.test.ts", 'darwin')).toBe("npx vitest run 'it'\\''s.test.ts'");
  });

  it('double-quotes the file for cmd.exe on Windows', () => {
    expect(testCommandLine('npx vitest run', 'a&b c.test.ts', 'win32')).toBe('npx vitest run "a&b c.test.ts"');
  });
});

describe('redCheck', () => {
  it('passes when every new or changed test file fails against the base code', () => {
    expect(redCheck(['a.test.ts', 'b.test.ts'], { 'a.test.ts': 1, 'b.test.ts': 1 }, [])).toEqual([]);
  });

  it('flags a test file that already passes on the base code: it proves nothing about the change', () => {
    expect(redCheck(['a.test.ts', 'b.test.ts'], { 'a.test.ts': 1, 'b.test.ts': 0 }, [])).toEqual([
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

  it.each([1, 2, 125, 128, 9008, 9010])('counts exit %i as red', (exit) => {
    expect(redCheck(['a.test.ts'], { 'a.test.ts': exit }, [])).toEqual([]);
  });

  it('flags a file it has no result for, instead of passing it unchecked', () => {
    expect(redCheck(['c.test.ts'], {}, [])).toEqual([{ file: 'c.test.ts', detail: 'was not run against the base code' }]);
  });
});
