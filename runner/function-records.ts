// The function ledger's records (ticket 15c), written to the observation log beside the rest:
// - session: one model's tokens in, out, cache read and cache write in one headless session, read
//   from Claude Code's `--output-format json` result (per model when it says, else its summed usage
//   under the configured model). The wall time goes on the first record only, so a session's time
//   is counted once. A crashed session with no result is one error record with no tokens: the zero
//   guard sees a function that ran and recorded nothing.
//   The tool calls its permissions refused (permission_denials) follow as denial records (ticket 52).
// - hook: one hook call's wall time and whether it blocked.
// - stream: one input substream (a watched upstream repo): commits read and proposals made.

import { targetOf, type Observation, type ObservationBase, type SessionRecord } from './observations.ts';

export interface SessionInfo {
  /** The model the session was started with: the fallback when the result does not name one. */
  model: string;
  skills: string[];
  ms: number;
}

type Tokens = Pick<SessionRecord, 'tokensIn' | 'tokensOut' | 'cacheRead' | 'cacheWrite'>;

const count = (v: unknown) => (typeof v === 'number' ? v : 0);

export const perModel = (u: Record<string, unknown>): Tokens => ({
  tokensIn: count(u.inputTokens),
  tokensOut: count(u.outputTokens),
  cacheRead: count(u.cacheReadInputTokens),
  cacheWrite: count(u.cacheCreationInputTokens),
});

const summed = (u: Record<string, unknown>): Tokens => ({
  tokensIn: count(u.input_tokens),
  tokensOut: count(u.output_tokens),
  cacheRead: count(u.cache_read_input_tokens),
  cacheWrite: count(u.cache_creation_input_tokens),
});

function resultOf(stdout: string): Record<string, unknown> {
  try {
    return Object(JSON.parse(stdout)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** [model, tokens] per model the session used; the summed usage under the configured model when no model is named. */
function usages(r: Record<string, unknown>, model: string): [string, Tokens][] {
  const named = Object.entries(Object(r.modelUsage) as Record<string, unknown>);
  if (named.length > 0) return named.map(([m, u]) => [m, perModel(Object(u))]);
  return [[model, summed(Object(r.usage))]];
}

export function sessionObservations(base: ObservationBase, fn: string, info: SessionInfo, stdout: string): Observation[] {
  const r = resultOf(stdout);
  const outcome = r.is_error === false ? 'ok' : 'error';
  const records = usages(r, info.model).map(([model, tokens], i): Observation => ({ ...base, kind: 'session', fn, model, ...tokens, ms: i === 0 ? info.ms : 0, outcome, skills: info.skills }));
  return [...records, ...denialsOf(base, r)];
}

function denialsOf(base: ObservationBase, r: Record<string, unknown>): Observation[] {
  const denials = Array.isArray(r.permission_denials) ? (r.permission_denials as unknown[]) : [];
  return denials.map((d) => {
    const { tool_name, tool_input } = Object(d) as Record<string, unknown>;
    return { ...base, kind: 'denial', tool: typeof tool_name === 'string' ? tool_name : 'unknown', target: targetOf(tool_input) };
  });
}

/** Ticket 52: each tool call the session's permissions refused, from its result's permission_denials. */
export const denialObservations = (base: ObservationBase, stdout: string): Observation[] => denialsOf(base, resultOf(stdout));

export const hookObservation = (base: ObservationBase, hook: string, ms: number, outcome: 'allow' | 'block'): Observation => ({
  ...base,
  kind: 'hook',
  hook,
  ms: Math.round(ms),
  outcome,
});

/**
 * What a substream's record needs of an input run (watchers/upstream.ts's UpstreamRun is one):
 * each repo read with its commits, and the proposals by repo. Its own shape (ticket 83), so these
 * records travel in the runner without the watchers.
 */
export type StreamRun = { status: 'skipped' | 'failed' } | { status: 'checked'; repos: { repo: string; commits: number }[]; proposals: { repo: string }[] };

/** One record per watched repo of a checked upstream run; none for a skipped or failed one. */
export function streamObservations(base: ObservationBase, run: StreamRun): Observation[] {
  if (run.status !== 'checked') return [];
  return run.repos.map((r) => ({ ...base, kind: 'stream', stream: r.repo, items: r.commits, ideas: run.proposals.filter((p) => p.repo === r.repo).length }));
}
