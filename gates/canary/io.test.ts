import { describe, expect, it } from 'vitest';
import { appendCanaryRecords, CANARY_LOG, type CanaryRecord } from './io.ts';

const record = (gate: string): CanaryRecord => ({ at: 't', run: 'canary-t', project: '', ticket: '', role: 'canary', kind: 'canary', gate, state: 'green', detail: 'd' });

describe('the canary log', () => {
  it('lives in logs/observations.jsonl under the state folder', () => {
    expect(CANARY_LOG).toBe('logs/observations.jsonl');
  });

  it('appends every record as one JSON line, in one write', () => {
    const appended: Array<[string, string]> = [];
    appendCanaryRecords('/s/log', [record('a'), record('b')], { append: (path, text) => appended.push([path, text]) });
    expect(appended).toEqual([['/s/log', `${JSON.stringify(record('a'))}\n${JSON.stringify(record('b'))}\n`]]);
  });

  it('writes nothing when there is no record', () => {
    const appended: string[] = [];
    appendCanaryRecords('/s/log', [], { append: (path) => appended.push(path) });
    expect(appended).toEqual([]);
  });
});
