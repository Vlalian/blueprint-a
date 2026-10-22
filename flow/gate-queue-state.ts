// The gate queue's file (ticket 84, from scripts/flow/gate-queue.ts): the ticket branches waiting
// for the merge gate, in order, and every gate's result. Kept apart from the runner
// (gate-queue.ts) so the build list (builds.ts) reads it without an import cycle. Pure.

import type { FlowConfig } from './config.ts';
import { FLOW_FILES, jsonOf, ticketNameOf, ticketOf } from './state.ts';

export interface GateEntry {
  ticket: string;
  branch: string;
  addedAt: string;
}

export type GateStatus = 'green' | 'red' | 'conflict';

export interface GateResult {
  ticket: string;
  branch: string;
  /** The ticket branch's head the gate ran on. */
  head: string;
  /** The integration branch's commit it was merged onto. */
  base: string;
  status: GateStatus;
  /** The stage that failed; none when green. */
  stage?: string;
  log: string;
  at: string;
}

export interface GateQueue {
  queue: GateEntry[];
  results: GateResult[];
}

export const EMPTY_GATES: GateQueue = { queue: [], results: [] };

/** The queue in the file's text; empty when there is none; throws naming the file when it is broken. */
export function readGates(text: string | undefined): GateQueue {
  const q = jsonOf<GateQueue>(text, EMPTY_GATES, FLOW_FILES.gateQueue);
  if (!Array.isArray(q.queue) || !Array.isArray(q.results)) throw new Error(`${FLOW_FILES.gateQueue} has no queue and results lists`);
  return q;
}

/** The latest gate result of a ticket. */
export const latestResult = (q: GateQueue, ticket: string) => q.results.findLast((r) => r.ticket === ticket);

/** Queues a ticket branch once; why not, when it is no ticket branch or already queued. */
export function addGate(q: GateQueue, branch: string, at: string, c: Pick<FlowConfig, 'branchPrefix'>): { queue: GateQueue; note: string } {
  const name = ticketNameOf(branch, c);
  if (name === undefined) return { queue: q, note: `${branch} is not a ${c.branchPrefix}<NN-name> branch; not queued` };
  if (q.queue.some((e) => e.branch === branch)) return { queue: q, note: `${branch} is already in the gate queue` };
  return { queue: { ...q, queue: [...q.queue, { ticket: ticketOf(name)!, branch, addedAt: at }] }, note: `${branch} queued for the merge gate (${q.queue.length + 1} in the queue)` };
}

export const resultLine = (r: GateResult) => `${r.ticket}  ${r.status}${r.stage === undefined ? '' : ` at ${r.stage}`}  ${r.branch} @ ${r.head.slice(0, 7)} on ${r.base.slice(0, 7)}  ${r.at}  log ${r.log}`;

/** The queue, then the latest result of each ticket. */
export function listLines(q: GateQueue): string[] {
  const queued = q.queue.map((e, i) => `${i + 1}. ${e.branch} (queued ${e.addedAt})`);
  const tickets = [...new Set(q.results.map((r) => r.ticket))];
  return ['Gate queue:', ...(queued.length === 0 ? ['(empty)'] : queued), 'Latest results:', ...(tickets.length === 0 ? ['(none)'] : tickets.map((t) => resultLine(latestResult(q, t)!)))];
}
