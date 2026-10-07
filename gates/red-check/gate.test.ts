import { describe, expect, it } from 'vitest';
import { redCheckGate, type RedCheckIo } from './gate.ts';

function fakeIo(changed: string[], exits: Record<string, number>) {
  const log: string[] = [];
  const io: RedCheckIo = {
    changedTests: (base) => (log.push(`changed ${base}`), changed),
    checkoutBase: (base) => {
      log.push(`checkout ${base}`);
      return { dir: '/tree', remove: () => log.push('remove') };
    },
    copyInto: (dir, file) => log.push(`copy ${file} -> ${dir}`),
    runTest: (dir, file) => (log.push(`run ${file} in ${dir}`), exits[file] ?? 0),
  };
  return { io, log };
}

describe('redCheckGate', () => {
  it('fails without checking out anything when no test is new or changed: the specifier added no test (ticket 35)', () => {
    const { io, log } = fakeIo([], {});
    expect(redCheckGate({ base: 'abc', allow: [] }, io)).toEqual({ gate: 'red-check', pass: false, base: 'abc', tests: [], findings: [{ file: '', detail: 'the specifier added no test' }] });
    expect(log).toEqual(['changed abc']);
  });

  it('copies each changed test into the base checkout, runs it there, and removes the checkout', () => {
    const { io, log } = fakeIo(['a.test.ts'], { 'a.test.ts': 1 });
    const result = redCheckGate({ base: 'abc', allow: [] }, io);
    expect(result).toEqual({
      gate: 'red-check',
      pass: true,
      base: 'abc',
      tests: ['a.test.ts'],
      exitAtBase: { 'a.test.ts': 1 },
      findings: [],
    });
    expect(log).toEqual(['changed abc', 'checkout abc', 'copy a.test.ts -> /tree', 'run a.test.ts in /tree', 'remove']);
  });

  it('fails a test that passes on the base code', () => {
    const { io } = fakeIo(['a.test.ts'], { 'a.test.ts': 0 });
    const result = redCheckGate({ base: 'abc', allow: [] }, io);
    expect(result.pass).toBe(false);
    expect(result.findings).toEqual([{ file: 'a.test.ts', detail: 'passes on the base code, so it does not prove the change' }]);
  });

  it('removes the checkout even when a run throws', () => {
    const { io, log } = fakeIo(['a.test.ts'], {});
    io.runTest = () => {
      throw new Error('spawn failed');
    };
    expect(() => redCheckGate({ base: 'abc', allow: [] }, io)).toThrow('spawn failed');
    expect(log.at(-1)).toBe('remove');
  });

  it('throws a usage error without --base', () => {
    expect(() => redCheckGate({ allow: [] }, fakeIo([], {}).io)).toThrow(/usage: red-check --base/);
  });
});
