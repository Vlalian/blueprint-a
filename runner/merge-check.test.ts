import { describe, expect, it } from 'vitest';
import { loadMergeCheck, type MergeCheck } from './merge-check.ts';

const check: MergeCheck = () => ({ lines: [], refused: false, records: () => [] });

describe('loadMergeCheck — the repo merge check config/runner.json names', () => {
  it('loads none when the config names none', async () => {
    const asked: string[] = [];
    expect(await loadMergeCheck({ mergeCheck: '' }, async (p) => (asked.push(p), {}))).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("is the named module's mergeCheck function", async () => {
    const asked: string[] = [];
    expect(await loadMergeCheck({ mergeCheck: 'tools/chosen.ts' }, async (p) => (asked.push(p), { mergeCheck: check }))).toBe(check);
    expect(asked).toEqual(['tools/chosen.ts']);
  });

  it('refuses a module without one, naming it', async () => {
    for (const module of [{}, { mergeCheck: 'yes' }, null]) {
      await expect(loadMergeCheck({ mergeCheck: 'tools/x.ts' }, async () => module)).rejects.toThrow('config/runner.json: mergeCheck tools/x.ts exports no mergeCheck function');
    }
  });
});
