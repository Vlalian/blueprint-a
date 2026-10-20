import { describe, expect, it } from 'vitest';
import { checkPlanned, planDeletions } from './plan.ts';

const plan = (deleteBody: string) => `Plan for: t.md\n\n## Approach\n- Test: not/here.test.ts::x -> y.test.ts::y\n\n## Delete\n${deleteBody}\n## Out of scope\nNone.\n`;

describe('planDeletions', () => {
  it("reads each Test line of the plan's Delete section: the test that goes and the test that replaces it", () => {
    const body = '- Code: src/old.ts, the legacy parse() its callers leave in this change.\n- Test: tests/a.test.ts::two -> tests/b.test.ts::two at the interface\n- Test: tests/old.test.ts -> tests/b.test.ts\n';
    expect(planDeletions(plan(body))).toEqual([
      { test: 'tests/a.test.ts::two', replacement: 'tests/b.test.ts::two at the interface' },
      { test: 'tests/old.test.ts', replacement: 'tests/b.test.ts' },
    ]);
  });

  it('reads a Test line without a replacement as listing none', () => {
    expect(planDeletions(plan('- Test: tests/a.test.ts::two\n- Test: tests/c.test.ts::three ->  \n'))).toEqual([
      { test: 'tests/a.test.ts::two', replacement: undefined },
      { test: 'tests/c.test.ts::three', replacement: undefined },
    ]);
  });

  it('lists nothing for a plan with "None." under Delete, or with no Delete section, or no plan text', () => {
    expect(planDeletions(plan('None.\n'))).toEqual([]);
    expect(planDeletions('Plan for: t.md\n\n## Approach\n- Test: a.test.ts::x -> b.test.ts::y\n')).toEqual([]);
    expect(planDeletions('')).toEqual([]);
  });

  it('reads only lines that start with "- Test:"', () => {
    expect(planDeletions(plan('A Test: a.test.ts::x -> b.test.ts::y line\nsee - Test: e.test.ts::x -> f.test.ts::y\n  - Test: c.test.ts::z -> d.test.ts::w\n'))).toEqual([
      { test: 'c.test.ts::z', replacement: 'd.test.ts::w' },
    ]);
  });
});

describe('checkPlanned', () => {
  const head: Record<string, string> = {
    'tests/b.test.ts': "it('two at the interface', () => {});\nit.skip('off', () => {});",
    'tests/off.test.ts': "it.skip('off', () => {});",
  };
  const read = (path: string) => head[path];
  const gone = [
    { file: 'tests/a.test.ts', title: 'two' },
    { file: 'tests/old.test.ts', title: 'one' },
  ];

  it('passes a listed deletion whose replacing test is on the branch, by file::title or by file', () => {
    const planned = [
      { test: 'tests/a.test.ts::two', replacement: 'tests/b.test.ts::two at the interface' },
      { test: 'tests/old.test.ts', replacement: 'tests/b.test.ts' },
    ];
    expect(checkPlanned(gone, planned, read)).toEqual({ deleted: [], unreplaced: [] });
  });

  it('leaves a deletion the plan does not list as deleted, as before', () => {
    const planned = [{ test: 'tests/a.test.ts::one', replacement: 'tests/b.test.ts' }];
    expect(checkPlanned(gone, planned, read)).toEqual({ deleted: gone, unreplaced: [] });
  });

  it('fails a listed deletion with no replacement, naming the test', () => {
    const planned = [{ test: 'tests/a.test.ts::two', replacement: undefined }];
    expect(checkPlanned(gone.slice(0, 1), planned, read).unreplaced).toEqual([
      { file: 'tests/a.test.ts', title: 'two', replacement: undefined, reason: 'tests/a.test.ts::two is listed under Delete with no replacing test' },
    ]);
  });

  it('fails a listed deletion whose replacement is missing, naming both: no such file, no such title, or only a switched-off test', () => {
    const missing = (replacement: string) => checkPlanned(gone.slice(0, 1), [{ test: 'tests/a.test.ts::two', replacement }], read).unreplaced;
    for (const replacement of ['tests/gone.test.ts::two', 'tests/b.test.ts::two', 'tests/b.test.ts::off', 'tests/off.test.ts', 'tests/gone.test.ts']) {
      expect(missing(replacement)).toEqual([
        { file: 'tests/a.test.ts', title: 'two', replacement, reason: `tests/a.test.ts::two is listed under Delete, but its replacing test ${replacement} is not on the branch` },
      ]);
    }
  });

  it('fails a listed deletion whose replacement is not a test file, even one holding test syntax, naming both', () => {
    const docs: Record<string, string> = { 'README.md': "it('two at the interface', () => {});", 'docs/example.ts': "it('two', () => {});" };
    const missing = (replacement: string) => checkPlanned(gone.slice(0, 1), [{ test: 'tests/a.test.ts::two', replacement }], (path) => docs[path]).unreplaced;
    for (const replacement of ['README.md::two at the interface', 'README.md', 'docs/example.ts::two']) {
      expect(missing(replacement)).toEqual([
        { file: 'tests/a.test.ts', title: 'two', replacement, reason: `tests/a.test.ts::two is listed under Delete, but its replacing test ${replacement} is not in a test file` },
      ]);
    }
  });
});
