import { describe, expect, it } from 'vitest';
import type { Observation } from './observations.ts';
import { missLine, selectionMisses } from './selection.ts';

const base = { run: '', project: 'workflow', role: '' };
const t = (minute: number) => new Date(Date.UTC(2026, 9, 5, 0, minute)).toISOString();
const selection = (minute: number, ticket: string, changed: string[], tests: string[], all = false): Observation => ({ ...base, ticket, at: t(minute), kind: 'selection', sha: 's', changed, all, reason: all ? 'shared ground' : '', tests });
const full = (minute: number): Observation => ({ ...base, ticket: '', at: t(minute), kind: 'full-run', sha: 's', why: 'idle', failing: [], ms: 1 });

describe('selectionMisses — failing tests no merge since their last run selected', () => {
  it('names the merges after the test last ran and every file they changed', () => {
    const records = [selection(1, 'ticket/a', ['gates/a.ts'], ['gates/x.test.ts']), selection(2, 'ticket/b', ['gates/c.ts', 'gates/b.ts'], ['gates/b.test.ts']), selection(3, 'ticket/c', ['gates/b.ts'], [])];
    expect(selectionMisses(records, ['gates/x.test.ts'])).toEqual([{ test: 'gates/x.test.ts', merges: ['ticket/b', 'ticket/c'], changed: ['gates/b.ts', 'gates/c.ts'] }]);
  });

  it('every merge since the last full run counts when none ran the test, in time order', () => {
    const records = [selection(3, 'ticket/b', ['b.ts'], []), selection(2, 'ticket/a', ['a.ts'], ['t.test.ts']), full(1)];
    expect(selectionMisses(records, ['t.test.ts'])).toEqual([{ test: 't.test.ts', merges: ['ticket/b'], changed: ['b.ts'] }]);
    expect(selectionMisses([selection(2, 'ticket/a', ['a.ts'], []), full(1)], ['t.test.ts'])).toMatchObject([{ merges: ['ticket/a'] }]);
  });

  it('no miss when the latest merge ran it, ran everything, or no merge came after the last full run', () => {
    expect(selectionMisses([selection(1, 'ticket/a', ['a.ts'], ['t.test.ts'])], ['t.test.ts'])).toEqual([]);
    expect(selectionMisses([selection(1, 'ticket/a', ['package.json'], [], true)], ['t.test.ts'])).toEqual([]);
    expect(selectionMisses([selection(1, 'ticket/a', ['a.ts'], []), full(2)], ['t.test.ts'])).toEqual([]);
    expect(selectionMisses([selection(2, 'ticket/a', ['a.ts'], [])], [])).toEqual([]);
    expect(selectionMisses([selection(2, 'ticket/a', ['a.ts'], []), full(2)], ['t.test.ts'])).toEqual([]);
  });

  it('reads as the test, the merges and the missing edge', () => {
    expect(missLine({ test: 't.test.ts', merges: ['ticket/a', 'ticket/b'], changed: ['a.ts', 'b.ts'] })).toBe(
      't.test.ts failed in the full run, and no merge since it last ran selected it (ticket/a, ticket/b); missing edge: t.test.ts depends on one of a.ts, b.ts',
    );
  });
});
