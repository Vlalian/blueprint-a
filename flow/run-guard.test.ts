import { describe, expect, it } from 'vitest';
import type { Acquired } from '../runner/lock.ts';
import { activeRun, guarded, newRun, type GuardIo } from './run-guard.ts';

const RUN = newRun(['a', 'b'], '2026-10-04T09:00:00.000Z', 42);

function fakeGuard(acquired: Acquired) {
  const calls: string[] = [];
  const io: GuardIo = {
    acquire: () => (calls.push('acquire'), acquired),
    release: (token) => void calls.push(`release ${token}`),
    writeCurrent: (text) => void calls.push(`current ${text}`),
    clearCurrent: () => void calls.push('clear current'),
    clearStopRequest: () => void calls.push('clear stop'),
  };
  return { io, calls };
}

describe('newRun', () => {
  it('names the run by its start time, safe as a folder name, with its projects and process', () => {
    expect(RUN).toEqual({ runId: '2026-10-04T09-00-00-000Z', projects: ['a', 'b'], startedAt: '2026-10-04T09:00:00.000Z', pid: 42 });
  });
});

describe('guarded', () => {
  it('holds the lock for the run: clears an old stop request, says what runs, then cleans up and releases', async () => {
    const g = fakeGuard({ ok: true, token: 't1' });
    const refused: string[] = [];
    await guarded(RUN, g.io, async () => void g.calls.push('body'), (p) => void refused.push(p));
    expect(g.calls).toEqual(['acquire', 'clear stop', `current ${JSON.stringify(RUN, null, 2)}`, 'body', 'clear current', 'clear stop', 'release t1']);
    expect(refused).toEqual([]);
  });

  it('releases the lock when the run throws, and the error still surfaces', async () => {
    const g = fakeGuard({ ok: true, token: 't1' });
    const body = () => Promise.reject(new Error('controller crashed'));
    await expect(guarded(RUN, g.io, body, () => {})).rejects.toThrow('controller crashed');
    expect(g.calls.slice(-3)).toEqual(['clear current', 'clear stop', 'release t1']);
  });

  it('refuses a second run while the lock is held, and touches nothing of the run that holds it', async () => {
    const holder = { pid: 9, host: 'pc', startedAt: '2026-10-04T08:00:00.000Z', token: 'x' };
    const g = fakeGuard({ ok: false, heldBy: holder });
    const refused: string[] = [];
    let ran = false;
    await guarded(RUN, g.io, async () => void (ran = true), (p) => void refused.push(p));
    expect(ran).toBe(false);
    expect(g.calls).toEqual(['acquire']);
    expect(refused).toEqual([activeRun(holder)]);
  });
});

describe('activeRun', () => {
  it('names the process holding the lock and since when, or says the lock could not be read', () => {
    expect(activeRun({ pid: 9, host: 'pc', startedAt: '2026-10-04T08:00:00.000Z', token: 'x' })).toBe(
      'Another run is active (pid 9 on pc, since 2026-10-04T08:00:00.000Z); not started. `/flow status` shows it, `/flow stop` stops it clean.',
    );
    expect(activeRun(null)).toBe('Another run holds the dispatcher lock (its lock file could not be read); not started.');
  });
});
