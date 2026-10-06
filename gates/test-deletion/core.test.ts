import { describe, expect, it } from 'vitest';
import { deletedTests, testCases, testTitles } from './core.ts';

describe('testTitles', () => {
  it('finds it() and test() titles in any quote style, including .each and .only', () => {
    const src = `
      it('adds', () => {});
      test("subtracts", () => {});
      it.each([[1, 2]])(\`doubles %i\`, () => {});
      it.only('focused', () => {});
      describe('group', () => {});
    `;
    expect(testTitles(src)).toEqual(['adds', 'subtracts', 'doubles %i', 'focused']);
  });
});

describe('deletedTests', () => {
  const base = {
    'tests/a.test.ts': "it('one', () => {});\nit('two', () => {});",
    'tests/b.test.ts': "it('only', () => {});",
  };

  it('reports nothing when every test still exists', () => {
    expect(deletedTests(base, base, [])).toEqual([]);
  });

  it('reports a removed test case', () => {
    const head = { ...base, 'tests/a.test.ts': "it('one', () => {});" };
    expect(deletedTests(base, head, [])).toEqual([{ file: 'tests/a.test.ts', title: 'two' }]);
  });

  it('reports every test of a deleted file', () => {
    const head = { 'tests/a.test.ts': base['tests/a.test.ts'] };
    expect(deletedTests(base, head, [])).toEqual([{ file: 'tests/b.test.ts', title: 'only' }]);
  });

  it('counts a renamed test as deleted, since the guard cannot know it is the same test', () => {
    const head = { ...base, 'tests/b.test.ts': "it('only, renamed', () => {});" };
    expect(deletedTests(base, head, [])).toEqual([{ file: 'tests/b.test.ts', title: 'only' }]);
  });

  it('counts each copy of a repeated title, so deleting one of two same-named tests is seen', () => {
    const twice = { 'tests/c.test.ts': "describe('x', () => { it('works', () => {}); });\ndescribe('y', () => { it('works', () => {}); });" };
    const once = { 'tests/c.test.ts': "describe('x', () => { it('works', () => {}); });" };
    expect(deletedTests(twice, once, [])).toEqual([{ file: 'tests/c.test.ts', title: 'works' }]);
    expect(deletedTests(twice, twice, [])).toEqual([]);
    expect(deletedTests(once, twice, [])).toEqual([]);
  });

  it('allows a deletion the plan lists, by file or by file::title', () => {
    const head = { 'tests/a.test.ts': "it('one', () => {});" };
    expect(deletedTests(base, head, ['tests/b.test.ts', 'tests/a.test.ts::two'])).toEqual([]);
  });
});

describe('deletedTests: a test switched off counts as deleted (decision 36)', () => {
  const file = 'tests/a.test.ts';
  const one = (head: string, allowed: string[] = []) => deletedTests({ [file]: "it('one', () => {});" }, { [file]: head }, allowed);

  it.each([
    "it.skip('one', () => {});",
    "it.todo('one');",
    "test.skip('one', () => {});",
    "test.todo('one');",
    "xit('one', () => {});",
    "xtest('one', () => {});",
    "it.skip.each([[1]])('one', () => {});",
    "it.concurrent.skip('one', () => {});",
  ])('counts %s as deleting the test', (head) => {
    expect(one(head)).toEqual([{ file, title: 'one' }]);
  });

  it.each([
    "xdescribe('group', () => { it('one', () => {}); });",
    "describe.skip('group', () => { it('one', () => {}); });",
    "describe.todo('group', () => { it('one', () => {}); });",
    "describe.skip.each([[1]])('group %i', () => { it('one', () => {}); });",
    "describe.concurrent.skip('group', () => { it('one', () => {}); });",
    "describe('outer', () => { describe.skip('inner', () => { it('one', () => {}); }); });",
  ])('counts a test inside %s as deleted', (head) => {
    expect(one(head)).toEqual([{ file, title: 'one' }]);
  });

  it('allows a switched-off test the plan lists', () => {
    expect(one("it.skip('one', () => {});", [`${file}::one`])).toEqual([]);
  });

  it('keeps counting a test that is still active: it.only, it.concurrent, it.each and a test after a skipped group', () => {
    expect(one("it.only('one', () => {});")).toEqual([]);
    expect(one("it.concurrent('one', () => {});")).toEqual([]);
    expect(one("describe.skip('g', () => { it('two', () => {}); });\nit('one', () => {});")).toEqual([]);
    expect(one("describe('g', () => { it('one', () => { expect(')').toBe(')'); }); });")).toEqual([]);
  });

  it('reads brackets and quotes in a skipped group as text, so its end is found where the call closes', () => {
    const head = "describe.skip('g (', () => { it('two', () => { const s = \"(\" + `(`; }); });\nit('one', () => {});";
    expect(one(head)).toEqual([]);
  });

  it('reads an escaped quote as part of its string', () => {
    const head = "describe.skip('it\\'s (', () => { it('two', () => {}); });\nit('one', () => {});";
    expect(one(head)).toEqual([]);
  });

  it('ends a skipped group exactly where its call closes, even with a test right after it', () => {
    expect(one("describe.skip('g', () => {})it('one', () => {});")).toEqual([]);
  });

  it('treats a test that was already off at the base as present while it is still there, on or off', () => {
    const base = { [file]: "it.skip('one', () => {});" };
    expect(deletedTests(base, { [file]: "it.skip('one', () => {});" }, [])).toEqual([]);
    expect(deletedTests(base, { [file]: "it('one', () => {});" }, [])).toEqual([]);
    expect(deletedTests(base, { [file]: '' }, [])).toEqual([{ file, title: 'one' }]);
  });

  it('matches an active test first: one active and one skipped copy at the base need one active copy at head', () => {
    const base = { [file]: "it('one', () => {});\nit.skip('one', () => {});" };
    expect(deletedTests(base, { [file]: "it.skip('one', () => {});\nit('one', () => {});" }, [])).toEqual([]);
    expect(deletedTests(base, { [file]: "it.skip('one', () => {});\nit.skip('one', () => {});" }, [])).toEqual([{ file, title: 'one' }]);
  });
});

describe('testCases', () => {
  it('marks each test as on or off', () => {
    const src = "it('a', () => {});\nxit('b', () => {});\nxdescribe('g', () => { test('c', () => {}); });\ntest('d', () => {});";
    expect(testCases(src)).toEqual([
      { title: 'a', active: true },
      { title: 'b', active: false },
      { title: 'c', active: false },
      { title: 'd', active: true },
    ]);
  });

  it('does not take a word that ends in it or test for a test call', () => {
    expect(testCases("submit('a');\nlatest('b');\nexit('c');")).toEqual([]);
  });

  it('runs a skipped group to the end of the file when its call never closes', () => {
    expect(testCases("describe.skip('g', () => { it('a', () => {});")).toEqual([{ title: 'a', active: false }]);
  });
});
