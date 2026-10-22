// The flow's observation records (ticket 84): one JSON object per line in the state folder's
// observations.jsonl, in the shape of the runner's observation log (at, run, project, ticket, role,
// kind), so the evaluation reads them the same way. build-review: one build or review round, with
// the family that built it, the one that reviewed it, its round, wall time and exit code.
// base-into: what happened to one open ticket branch when the integration branch was merged into it
// (pushed, skipped, conflict, typecheck, push-failed, worktree), so the evaluation counts how often
// the base breaks an open branch (11-optimisations item 7).

import type { Finding } from '../gates/review-schema/schema.ts';
import type { ObservationBase } from '../runner/observations.ts';
import type { FlowConfig } from './config.ts';
import { flowPath, FLOW_FILES } from './state.ts';

export type BuildReviewRecord = ObservationBase & {
  kind: 'build-review';
  builder: string;
  reviewer?: string;
  round: string;
  head?: string;
  ms: number;
  exitCode: number;
  timedOut?: boolean;
  findings?: Finding[];
  errors?: string[];
};

export type BaseIntoOutcome = 'pushed' | 'skipped' | 'conflict' | 'typecheck' | 'push-failed' | 'worktree';

export type BaseIntoRecord = ObservationBase & { kind: 'base-into'; branch: string; base: string; outcome: BaseIntoOutcome; files: string[]; detail?: string };

export type FlowRecord = BuildReviewRecord | BaseIntoRecord;

/** Appends the records to the state folder's observation log, one line each; nothing for none. */
export function appendRecords(root: string, c: Pick<FlowConfig, 'stateDir'>, records: FlowRecord[], io: { append(path: string, text: string): void }): void {
  if (records.length > 0) io.append(flowPath(root, c, FLOW_FILES.observations), records.map((r) => `${JSON.stringify(r)}\n`).join(''));
}
