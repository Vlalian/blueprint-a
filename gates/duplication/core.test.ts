import { describe, expect, it } from 'vitest';
import { clonesTouching, parseReport, type Clone } from './core.ts';

const fragment = (name: string, start: number, end: number) => ({ name, start, end, startLoc: { line: start }, endLoc: { line: end } });

describe('parseReport', () => {
  it("reads each clone's two fragments from jscpd's JSON report, with forward-slash paths", () => {
    const report = {
      duplicates: [{ firstFile: fragment('src\\a.ts', 1, 8), secondFile: fragment('src/b.ts', 3, 10), lines: 8, tokens: 51, fragment: 'x' }],
      statistics: {},
    };
    expect(parseReport(JSON.stringify(report))).toEqual([
      { first: { file: 'src/a.ts', start: 1, end: 8 }, second: { file: 'src/b.ts', start: 3, end: 10 }, lines: 8 },
    ]);
  });

  it('reads a report with no duplicates as no clones', () => {
    expect(parseReport(JSON.stringify({ duplicates: [] }))).toEqual([]);
    expect(parseReport('{}')).toEqual([]);
  });
});

describe('clonesTouching', () => {
  const clone: Clone = { first: { file: 'src/a.ts', start: 10, end: 20 }, second: { file: 'src/b.ts', start: 1, end: 11 }, lines: 11 };
  const line = (file: string, n: number) => ({ file, line: n, text: '' });

  it('keeps a clone when a changed line falls inside either fragment, ends included', () => {
    expect(clonesTouching([clone], [line('src/a.ts', 10)])).toEqual([clone]);
    expect(clonesTouching([clone], [line('src/a.ts', 20)])).toEqual([clone]);
    expect(clonesTouching([clone], [line('src/b.ts', 1)])).toEqual([clone]);
    expect(clonesTouching([clone], [line('src/b.ts', 11)])).toEqual([clone]);
  });

  it('drops a clone in untouched code: changed lines outside its fragments, or in another file', () => {
    expect(clonesTouching([clone], [line('src/a.ts', 9), line('src/a.ts', 21), line('src/b.ts', 12)])).toEqual([]);
    expect(clonesTouching([clone], [line('src/c.ts', 15)])).toEqual([]);
    expect(clonesTouching([clone], [])).toEqual([]);
  });
});
