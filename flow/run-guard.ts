// The dispatcher's guard (ticket 26): one run at a time, and the owner's clean stop.
// - The run holds state/dispatcher.lock (scripts/lock.ts) while it runs; a second dispatcher is
//   refused and told which process holds it. A holder that died is taken over, as in lock.ts.
// - state/current-run.json says what is running and since when, for `/flow status`.
// - state/stop-request is the owner's stop (`/flow stop`). The controllers read it between tickets
//   beside the run's own stop flag (run-io.ts stopReasonOf), so the ticket in progress finishes,
//   the rest stay in ready, and the run writes its briefing. A request left over from an earlier
//   run is cleared before this one says it runs, and the run clears its own at the end.

import type { Acquired, LockRecord } from '../runner/lock.ts';

export interface CurrentRun {
  runId: string;
  projects: string[];
  startedAt: string;
  pid: number;
}

export interface GuardIo {
  acquire(): Acquired;
  release(token: string): void;
  writeCurrent(text: string): void;
  clearCurrent(): void;
  clearStopRequest(): void;
}

export const newRun = (projects: string[], now: string, pid: number): CurrentRun => ({ runId: now.replace(/[:.]/g, '-'), projects, startedAt: now, pid });

export const activeRun = (by: LockRecord | null) =>
  by === null
    ? 'Another run holds the dispatcher lock (its lock file could not be read); not started.'
    : `Another run is active (pid ${by.pid} on ${by.host}, since ${by.startedAt}); not started. \`/flow status\` shows it, \`/flow stop\` stops it clean.`;

/** Runs `body` holding the dispatcher lock, or refuses when another run holds it. */
export async function guarded(run: CurrentRun, io: GuardIo, body: () => Promise<void>, refuse: (problem: string) => void): Promise<void> {
  const lock = io.acquire();
  if (!lock.ok) return refuse(activeRun(lock.heldBy));
  io.clearStopRequest();
  io.writeCurrent(JSON.stringify(run, null, 2));
  try {
    await body();
  } finally {
    io.clearCurrent();
    io.clearStopRequest();
    io.release(lock.token);
  }
}
