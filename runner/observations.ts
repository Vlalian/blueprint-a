// The learning loop's observation log (blueprint-b section 8, phase 2 decision 15), one JSON object
// per line in state/logs/observations.jsonl. Append-only, like the other logs: a crash leaves at
// most one cut-off last line, which the reader skips. Every record has the same five fields first
// (at, run, project, ticket, role) and a kind:
// - tool: every agent tool call (the observe post-tool hook): tool, target, result.
// - gate: one check of a gate run (the Stop gate): gate, sha, verdict, reasons, ms, tokens when a
//   model was involved. Ticket 15b counts catches (fail, then pass on the same ticket and gate),
//   could-not-run and cost from these. The self-gate logs one per stage (gate self-gate-<stage>,
//   ticket 31), its unit stage with the ten slowest test files in `slowest`. A cloud role's check
//   (ticket 32, dispatcher/cloud-judge.ts) says where its result came from in `source`, and so does
//   every check of the Stop gate and the controller (ticket 37, gates/four-checks/cache.ts): `ran`,
//   or `cached` with the ms of the run it reused in `savedMs`.
// - escalation and retry: from the Stop gate, the loop monitor and the controller's decisions.
// - finding: a review finding and its triage (fate, reason). A finding names the gate that should
//   have caught it in `gate` when one fits, which is how ticket 15b counts an escape, and the
//   commit its ticket was built on in `sha`: the commit every gate passed. Other sources (ci,
//   incident, revert, owner) record their escapes as findings too. CodeRabbit's comments on a draft
//   PR (ticket 44) are findings with source coderabbit, their PR, line and classification.
// - suppression: a suppression written for a gate (gate, file, reason); ticket 15b counts it as
//   that gate's false alarm. Ticket 61: a mutant onkel let through after the simplification pass
//   also has its mutator, comment, proof (why), briefing item, branch and commit.
// - suppression-check (ticket 61, dispatcher/suppression-check.ts): the owner kept or rejected one
//   such suppression on the briefing, by its item, with a note.
// - canary: one gate's weekly prove-it-bites rerun (gates/canary): its state and why.
// - input: one substream of the input stream (ticket 21): items read, ideas made, an idea accepted
//   into a tracker, or a run that failed; count and a one-line detail.
// - session, hook, stream (ticket 15c, dispatcher/function-records.ts): one model's tokens and the
//   wall time of one headless session, one hook call's wall time, and one input substream's items
//   read and ideas, for the function ledger.
// - resume (ticket 38, dispatcher/resume.ts): an escalated ticket's next build resumed at the role
//   it stopped at, or restarted from the base and why; savedMinutes is what the kept roles' last
//   sessions took.
// - fire, build, merge-prep (ticket 53, dispatcher/tempo-records.ts): a cloud build's fire and its
//   time to the Result push, and a merge's preparation before its gate, for the tempo stats.
// - denial (ticket 52, dispatcher/function-records.ts): one tool call a headless session's
//   permissions refused, with its target; dispatcher/session-facts.ts reads it for the improver.
// - selection, full-run, selection-miss (ticket 56, dispatcher/selection-records.ts): the tests a
//   merge gate ran, the whole suite's safety-net run, and a test the selection missed.
// - choice: the owner's click on a waiting item (accept, reject, override), with the note and, for
//   a lesson, the destination left and the one suggested; an override names its gate (a false
//   alarm, which the gate metrics count). The dispatcher makes it (dispatcher/run-observations.ts).
// Other modules add kinds through `MoreRecords` (ticket 83): the dispatcher's applied,
// complexity, improvement, workflow-merge and its branch-merge records are in
// dispatcher/run-observations.ts, so this log travels without the dispatcher.

import type { SourcedGate } from '../gates/four-checks/cache.ts';
import type { GateResult } from '../gates/four-checks/check.ts';
import type { TempoRecord } from './tempo-records.ts';
import type { SelectionRecord } from './selection-records.ts';

export const OBSERVATIONS = 'logs/observations.jsonl';

export interface ObservationBase {
  at: string;
  run: string;
  project: string;
  ticket: string;
  role: string;
  /** Where the record was made: absent on this PC, `cloud` for a cloud session's carried-back record (ticket 27). */
  placement?: 'cloud';
}

export type GateVerdict = 'pass' | 'fail' | 'could-not-run';

/** One test file and its wall time, from vitest's JSON report: the self-gate's unit stage names its ten slowest (ticket 31). */
export type SlowTestFile = { file: string; ms: number };

/** green: still bites; red: an injected fault no longer fails, or clean input fails. */
export type CanaryState = 'green' | 'red' | 'could-not-run';

export type ToolObservation = ObservationBase & { kind: 'tool'; tool: string; target: string; result: 'ok' | 'error' };

export type Observation =
  | ToolObservation
  | (ObservationBase &
      (
        | {
            kind: 'gate';
            gate: string;
            sha: string;
            verdict: GateVerdict;
            reasons: string[];
            ms: number;
            tokens?: number;
            slowest?: SlowTestFile[];
            /**
             * A cloud role's check (ticket 32): its result from the cloud's round report, or from a run here; `sampled` when a trusted check ran here too.
             * A check of the Stop gate or the controller (ticket 37): `ran`, or `cached` from an earlier pass on the same tree, with `savedMs` the ms that run took.
             */
            source?: 'cloud-report' | 'local' | 'ran' | 'cached';
            savedMs?: number;
            sampled?: boolean;
          }
        | { kind: 'escalation'; source: string; reason: string }
        | { kind: 'retry'; reason: string }
        | {
            kind: 'finding';
            source: string;
            id: string;
            severity: string;
            axis: string;
            file: string;
            summary: string;
            fate: string;
            reason: string;
            gate?: string;
            sha?: string;
            /** A CodeRabbit finding (ticket 44, dispatcher/coderabbit.ts): its PR, line and triage (real-defect, style, false-alarm). */
            pr?: number;
            line?: number;
            classification?: string;
            /** Ticket 65: the effort CodeRabbit's new header names (Quick win, ...); its category is the axis. */
            effort?: string;
          }
        | ({ kind: 'suppression'; gate: string; file: string; reason: string } & Partial<MutantSuppression>)
        | { kind: 'suppression-check'; item: string; choice: 'accept' | 'reject'; note: string }
        | { kind: 'canary'; gate: string; state: CanaryState; detail: string }
        /** Tickets 33, 43: a filed plan, approved by the controller itself (auto) or left to the owner, and why. */
        | { kind: 'approval'; item: string; approval: 'auto' | 'owner'; reason: string }
        /** Ticket 76: a read record names the item ids it logged, so a retry after a failed cursor write logs each item once. */
        | { kind: 'input'; substream: string; event: 'read' | 'ideas' | 'accepted' | 'failed'; count: number; detail: string; items?: string[] }
        | SessionRecord
        | { kind: 'hook'; hook: string; ms: number; outcome: 'allow' | 'block' }
        | { kind: 'stream'; stream: string; items: number; ideas: number }
        | { kind: 'resume'; mode: 'resumed' | 'restarted'; reason: string; savedMinutes: number }
        | TempoRecord
        | SelectionRecord
        | DenialRecord
        | ChoiceRecord
        | MoreRecords[keyof MoreRecords]
      ));

/**
 * Record kinds another module adds by declaration merging (ticket 83): each key a kind, each value
 * its record without the five shared fields. The dispatcher adds its own in
 * dispatcher/run-observations.ts, so this log imports nothing of the dispatcher's; without them
 * (the Blueprint A runner) it has none.
 */
export interface MoreRecords {}

/**
 * Ticket 61 (dispatcher/suppress.ts): a mutant the dispatcher suppressed after the simplification
 * pass, with its comment, the hardener's proof that refactoring cannot remove it, its briefing item
 * and the commit; the owner's keep or reject of it is a `suppression-check`.
 */
export type MutantSuppression = { mutator: string; comment: string; why: string; item: string; branch: string; commit: string };

/** Ticket 52: one tool call a headless session's permissions refused, from its result's permission_denials (dispatcher/function-records.ts). */
export type DenialRecord = { kind: 'denial'; tool: string; target: string };

/** The owner's choice on one waiting item; its item kind and destinations as the briefing names them. */
export type ChoiceRecord = { kind: 'choice'; item: string; itemKind: string; choice: 'accept' | 'reject' | 'override'; note: string; destination?: string; suggested?: string; gate?: string };

/** One model's share of one headless session (ticket 15c): `fn` is the function id in config/functions.json. */
export interface SessionRecord {
  kind: 'session';
  fn: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  /** null: a cloud session whose run log reported no usage (ticket 27); its cost is unknown, never zero. */
  tokens?: null;
  ms: number;
  outcome: 'ok' | 'error';
  /** The skills the session was started with. */
  skills: string[];
}

type Env = Record<string, string | undefined>;
type Input = { tool_name?: unknown; tool_input?: unknown; tool_response?: unknown };

const TARGET_KEYS = ['file_path', 'notebook_path', 'command', 'pattern', 'url', 'description'];
const TARGET_LENGTH = 200;

function objectOf(raw: string): Input | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {}
  return typeof value === 'object' && value !== null ? (value as Input) : undefined;
}

/** A tool call's target: its path, command, pattern, URL or description, on one line and cut short. */
export function targetOf(input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const value = TARGET_KEYS.map((k) => args[k]).find((v) => typeof v === 'string') as string | undefined;
  return (value ?? '').replace(/\s+/g, ' ').slice(0, TARGET_LENGTH);
}

function resultOf(response: unknown): 'ok' | 'error' {
  const r = (response ?? {}) as Record<string, unknown>;
  return r.is_error === true || r.success === false || r.interrupted === true || r.error !== undefined ? 'error' : 'ok';
}

export const baseOf = (env: Env, at: string): ObservationBase => ({
  at,
  run: env.WORKFLOW_RUN_ID ?? '',
  project: env.WORKFLOW_PROJECT ?? '',
  ticket: env.WORKFLOW_TICKET ?? '',
  role: env.WORKFLOW_ROLE ?? '',
});

/** The record for one post-tool hook call; undefined outside a workflow run or for input that is not an object. */
export function toolObservation(env: Env, raw: string, at: string): ToolObservation | undefined {
  const input = env.WORKFLOW_STATE_DIR ? objectOf(raw) : undefined;
  if (input === undefined) return undefined;
  const tool = typeof input.tool_name === 'string' ? input.tool_name : 'unknown';
  return { ...baseOf(env, at), kind: 'tool', tool, target: targetOf(input.tool_input), result: resultOf(input.tool_response) };
}

export const observationLine = (o: Observation) => `${JSON.stringify(o)}\n`;

export function appendObservations(path: string, records: Observation[], io: { append(path: string, text: string): void }): void {
  if (records.length > 0) io.append(path, records.map(observationLine).join(''));
}

function recordOf(line: string): Observation[] {
  try {
    // Object() makes null and plain values empty objects, which have no kind.
    const value = Object(JSON.parse(line)) as Partial<Observation>;
    return typeof value.kind === 'string' && typeof value.at === 'string' ? [value as Observation] : [];
  } catch {
    return [];
  }
}

/** Every whole record in the log's text; a cut-off, blank or foreign line is skipped. */
export const parseObservations = (text: string | undefined): Observation[] => (text === undefined ? [] : text.split('\n').flatMap(recordOf));

const REASON_LINES = 5;
const reasonsOf = (tail: string) => tail.trimEnd().split('\n').slice(-REASON_LINES);

/** One record per check of a four-checks run, with each check's time; one could-not-run record when it could not run. */
export function gateObservations(base: ObservationBase, gate: GateResult, ms: number[], sha: string): Observation[] {
  if (gate.error !== undefined) return [{ ...base, kind: 'gate', gate: gate.gate, sha, verdict: 'could-not-run', reasons: [gate.error], ms: 0 }];
  return gate.results.map((r, i) => {
    const pass = r.exitCode === 0;
    return { ...base, kind: 'gate', gate: r.name, sha, verdict: pass ? 'pass' : 'fail', reasons: pass ? [] : reasonsOf(r.tail), ms: ms[i] };
  });
}

const sourceOf = (r: SourcedGate['results'][number]) => (r.savedMs === undefined ? { source: r.source } : { source: r.source, savedMs: r.savedMs });

/** gateObservations for a cached gate run (ticket 37): each check with its ms here, its source, and for a cached one the ms it saved. */
export function sourcedGateObservations(base: ObservationBase, gate: SourcedGate, sha: string): Observation[] {
  const records = gateObservations(base, gate, gate.results.map((r) => r.ms), sha);
  return gate.error !== undefined ? records : records.map((o, i) => ({ ...o, ...sourceOf(gate.results[i]!) }) as Observation);
}
