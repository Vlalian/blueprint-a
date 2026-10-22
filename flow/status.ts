// flow status (ticket 84, from scripts/flow/status.ts): the flow in one table: each open build and
// its state, the gate queue and each open ticket's latest gate, the builds in flight against the
// configured cap, and a warning under the table when they break it (11-optimisations item 7).
// Read only. With git and the files injected.

import { builds, type Build, type BuildsIo } from './builds.ts';
import type { FlowConfig } from './config.ts';
import { latestResult, readGates } from './gate-queue-state.ts';
import { buildsInFlight, capWarning, readInFlight, type InFlightIo } from './in-flight.ts';
import { flowPath, FLOW_FILES } from './state.ts';

export type StatusIo = BuildsIo & Pick<InFlightIo, 'git' | 'read'>;

type Row = [string, string, string, string];

const short = (sha: string) => sha.slice(0, 7);

function gateRows(open: Build[], c: FlowConfig, io: StatusIo): Row[] {
  const q = readGates(io.read(flowPath(io.root, c, FLOW_FILES.gateQueue)));
  const results = open.flatMap((b) => {
    const r = latestResult(q, b.ticket);
    return r === undefined ? [] : [['gate', `${r.ticket} ${r.branch}`, r.stage === undefined ? r.status : `${r.status} at ${r.stage}`, `${short(r.head)} on ${short(r.base)}`] as Row];
  });
  return [...open.map((b): Row => ['build', `${b.ticket} ${b.branch}`, b.state, short(b.head)]), ...q.queue.map((e): Row => ['gate queue', e.branch, 'queued', e.addedAt]), ...results];
}

/** Each build in flight, then their count against the cap; the warning when they break it. */
function flightRows(all: Build[], c: FlowConfig, io: StatusIo): { rows: Row[]; warning?: string } {
  const recorded = readInFlight(c, io);
  const since = new Map(recorded.map((f) => [f.branch, `since ${f.at}`]));
  const flights = buildsInFlight(all, recorded);
  const warning = capWarning(flights, c);
  const cap: Row = ['build cap', `${flights.length} of ${c.buildCap}`, warning === undefined ? 'ok' : 'exceeded', 'every family together'];
  return { rows: [...flights.map((f): Row => ['in flight', f.branch, f.family, since.get(f.branch) ?? 'no Result yet']), cap], warning };
}

/** Rows as a table, each column as wide as its widest cell. */
export function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd()).join('\n');
}

/** Prints the table, then a warning when the builds in flight break the cap. */
export function status(c: FlowConfig, io: StatusIo): number {
  const all = builds(c, io);
  const flights = flightRows(all, c, io);
  const rows = [...gateRows(all.filter((b) => b.state !== 'merged'), c, io), ...flights.rows];
  io.out(`${table([['what', 'item', 'state', 'detail'], ...rows])}\n${flights.warning === undefined ? '' : `\nWarning: ${flights.warning}\n`}`);
  return 0;
}
