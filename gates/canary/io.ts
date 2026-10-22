// The canary's log (ticket 82): one JSON line per gate and run, appended to the observation log
// under the state folder. The record has the observation log's shape (a harness's briefing reads
// it beside its other records), but it is defined here so the gate needs no harness code.

/** green: still bites; red: an injected fault no longer fails, or clean input fails. */
export type CanaryState = 'green' | 'red' | 'could-not-run';

export interface CanaryRecord {
  at: string;
  run: string;
  project: string;
  ticket: string;
  role: string;
  kind: 'canary';
  gate: string;
  state: CanaryState;
  detail: string;
}

/** The log, relative to the state folder. */
export const CANARY_LOG = 'logs/observations.jsonl';

/** Appends the records as JSON lines in one write; nothing when there are none. */
export function appendCanaryRecords(path: string, records: CanaryRecord[], io: { append(path: string, text: string): void }): void {
  if (records.length > 0) io.append(path, records.map((r) => `${JSON.stringify(r)}\n`).join(''));
}
