import { describe, expect, it } from 'vitest';
import { testDeletionGate, type DeletionIo } from './gate.ts';

const io = (base: Record<string, string>, head: Record<string, string>): DeletionIo => ({
  filesAt: () => Object.keys(base),
  showAt: (_ref, path) => base[path] ?? '',
  readHead: (path) => head[path],
});

describe('testDeletionGate', () => {
  it('passes when every base test is still there, and reports the base it compared against', () => {
    const files = { 'a.test.ts': "it('one', () => {});" };
    expect(testDeletionGate({ base: 'abc', allow: [] }, io(files, files))).toEqual({
      gate: 'test-deletion',
      pass: true,
      base: 'abc',
      deleted: [],
    });
  });

  it('fails on a deleted test file, reading only test files from the base', () => {
    const base = { 'a.test.ts': "it('one', () => {});", 'src/a.ts': "it('not a test file', () => {});" };
    const result = testDeletionGate({ base: 'abc', allow: [] }, io(base, {}));
    expect(result.pass).toBe(false);
    expect(result.deleted).toEqual([{ file: 'a.test.ts', title: 'one' }]);
  });

  it('passes the allow list through', () => {
    const base = { 'a.test.ts': "it('one', () => {});" };
    expect(testDeletionGate({ base: 'abc', allow: ['a.test.ts'] }, io(base, {})).pass).toBe(true);
  });

  it('throws a usage error without --base, which the shell turns into exit 2', () => {
    expect(() => testDeletionGate({ allow: [] }, io({}, {}))).toThrow(/usage: test-deletion --base/);
  });
});
