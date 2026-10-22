import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memFs, ROOT } from '../test/helpers/flow-fakes.ts';
import { appendRecords, type BaseIntoRecord } from './records.ts';

const record: BaseIntoRecord = { at: 'now', run: 'flow', project: '', ticket: '12', role: 'flow-merge', kind: 'base-into', branch: 'ticket/12-x', base: 'b', outcome: 'pushed', files: [] };

describe('the flow records', () => {
  it('are appended to the state folder, one line each, and nothing is written for none', () => {
    const fs = memFs();
    appendRecords(ROOT, { stateDir: 'var/flow' }, [], fs);
    expect(fs.writes).toEqual([]);
    appendRecords(ROOT, { stateDir: 'var/flow' }, [record, { ...record, ticket: '13' }], fs);
    expect(fs.read(join(ROOT, 'var', 'flow', 'observations.jsonl'))).toBe(`${JSON.stringify(record)}\n${JSON.stringify({ ...record, ticket: '13' })}\n`);
  });
});
