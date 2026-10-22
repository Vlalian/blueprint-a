import { describe, expect, it } from 'vitest';
import type { AddedLine } from '../lib/diff.ts';
import { duplicationGate, type DuplicationIo } from './gate.ts';

const report = JSON.stringify({
  duplicates: [
    { firstFile: { name: 'src\\a.ts', start: 1, end: 8 }, secondFile: { name: 'src\\b.ts', start: 1, end: 8 }, lines: 8 },
    { firstFile: { name: 'old/x.ts', start: 1, end: 6 }, secondFile: { name: 'old/y.ts', start: 1, end: 6 }, lines: 6 },
  ],
});

function fakeIo(changed: AddedLine[]) {
  const log: string[] = [];
  const io: DuplicationIo = {
    changedLines: (base) => (log.push(`changed ${base}`), changed),
    jscpdReport: () => (log.push('jscpd'), report),
  };
  return { io, log };
}

describe('duplicationGate', () => {
  it('fails on a clone that involves a changed line, and leaves clones in untouched code alone', () => {
    const { io, log } = fakeIo([{ file: 'src/b.ts', line: 3, text: 'x' }]);
    expect(duplicationGate({ base: 'abc' }, io)).toEqual({
      gate: 'duplication',
      pass: false,
      base: 'abc',
      clones: [{ first: { file: 'src/a.ts', start: 1, end: 8 }, second: { file: 'src/b.ts', start: 1, end: 8 }, lines: 8 }],
    });
    expect(log).toEqual(['changed abc', 'jscpd']);
  });

  it('passes when the only clones are in code the change did not touch', () => {
    const { io } = fakeIo([{ file: 'src/c.ts', line: 1, text: 'x' }]);
    expect(duplicationGate({ base: 'abc' }, io)).toEqual({ gate: 'duplication', pass: true, base: 'abc', clones: [] });
  });

  it('passes without running jscpd when nothing changed', () => {
    const { io, log } = fakeIo([]);
    expect(duplicationGate({ base: 'abc' }, io)).toEqual({ gate: 'duplication', pass: true, base: 'abc', clones: [] });
    expect(log).toEqual(['changed abc']);
  });

  it('cannot run without --base', () => {
    expect(() => duplicationGate({}, fakeIo([]).io)).toThrow('usage: duplication --base <ref> [--cwd <dir>]');
  });
});
