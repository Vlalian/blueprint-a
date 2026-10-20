import { describe, expect, it } from 'vitest';
import { testDeletionGate, type DeletionIo } from './gate.ts';

const io = (base: Record<string, string>, head: Record<string, string>, plans: Record<string, string> = {}): DeletionIo => ({
  filesAt: () => Object.keys(base),
  showAt: (_ref, path) => base[path] ?? '',
  readHead: (path) => head[path],
  readPlan: (path) => plans[path]!,
});

describe('testDeletionGate', () => {
  it('passes when every base test is still there, and reports the base it compared against', () => {
    const files = { 'a.test.ts': "it('one', () => {});" };
    expect(testDeletionGate({ base: 'abc', allow: [], plan: [] }, io(files, files))).toEqual({
      gate: 'test-deletion',
      pass: true,
      base: 'abc',
      deleted: [],
      unreplaced: [],
    });
  });

  it('fails on a deleted test file, reading only test files from the base', () => {
    const base = { 'a.test.ts': "it('one', () => {});", 'src/a.ts': "it('not a test file', () => {});" };
    const result = testDeletionGate({ base: 'abc', allow: [], plan: [] }, io(base, {}));
    expect(result.pass).toBe(false);
    expect(result.deleted).toEqual([{ file: 'a.test.ts', title: 'one' }]);
  });

  it('passes the allow list through', () => {
    const base = { 'a.test.ts': "it('one', () => {});" };
    expect(testDeletionGate({ base: 'abc', allow: ['a.test.ts'], plan: [] }, io(base, {})).pass).toBe(true);
  });

  it('throws a usage error without --base, which the shell turns into exit 2', () => {
    expect(() => testDeletionGate({ allow: [], plan: [] }, io({}, {}))).toThrow(/usage: test-deletion --base/);
  });

  // Ticket 70: the plan's Delete section lets a test go only with the test that replaces it.
  describe("with the plan's Delete section (--plan)", () => {
    const base = { 'a.test.ts': "it('one', () => {});\nit('two', () => {});" };
    const plan = (line: string) => `Plan for: t.md\n\n## Delete\n${line}\n\n## Out of scope\nNone.\n`;
    const gate = (line: string, head: Record<string, string>) => testDeletionGate({ base: 'abc', allow: [], plan: ['plan.md'] }, io(base, head, { 'plan.md': plan(line) }));
    const without = { 'a.test.ts': "it('one', () => {});" };

    it('passes a listed deletion when its replacing test exists on the branch', () => {
      const head = { ...without, 'b.test.ts': "it('two at the interface', () => {});" };
      expect(gate('- Test: a.test.ts::two -> b.test.ts::two at the interface', head)).toMatchObject({ pass: true, deleted: [], unreplaced: [] });
    });

    it('fails a listed deletion when its replacing test does not exist, naming both', () => {
      const result = gate('- Test: a.test.ts::two -> b.test.ts::two at the interface', without);
      expect(result.pass).toBe(false);
      expect(result.deleted).toEqual([]);
      expect(result.unreplaced).toEqual([
        { file: 'a.test.ts', title: 'two', replacement: 'b.test.ts::two at the interface', reason: 'a.test.ts::two is listed under Delete, but its replacing test b.test.ts::two at the interface is not on the branch' },
      ]);
    });

    it('fails a listed deletion that names no replacement', () => {
      const result = gate('- Test: a.test.ts::two', without);
      expect(result.pass).toBe(false);
      expect(result.unreplaced).toEqual([{ file: 'a.test.ts', title: 'two', replacement: undefined, reason: 'a.test.ts::two is listed under Delete with no replacing test' }]);
    });

    it('fails when one deletion is unlisted and another unreplaced', () => {
      const result = gate('- Test: a.test.ts::two', {});
      expect(result).toMatchObject({ pass: false, deleted: [{ file: 'a.test.ts', title: 'one' }], unreplaced: [{ file: 'a.test.ts', title: 'two' }] });
    });

    it('fails a deleted test the plan does not list, as before', () => {
      const result = gate('- Test: a.test.ts::one -> a.test.ts::one', without);
      expect(result).toMatchObject({ pass: false, deleted: [{ file: 'a.test.ts', title: 'two' }], unreplaced: [] });
    });
  });
});
