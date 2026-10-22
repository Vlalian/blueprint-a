// config/evaluation.json (ticket 15c): the thresholds each function's suggestion comes from, as
// data. Every key must be there and be a number of its kind; anything missing, unknown or malformed
// is an error, never a default, and no evaluation is written.

export interface EvaluationConfig {
  /** Runs of only zeros or nothing before a function is a Needs you item. */
  zeroGuardRuns: number;
  /** p95 in ms above which a hook is slow: `default`, or the hook's own. */
  hookP95Ms: Record<string, number>;
  /** A gate with no catch costing this many minutes or USD over the window: remove. */
  gateRemoveAtMinutes: number;
  gateRemoveAtUsd: number;
  /** False alarms or could-not-run per run above which a gate is tuned. */
  gateTuneAboveFalseAlarmRate: number;
  gateTuneAboveCouldNotRunRate: number;
  /** Tickets passed on the first try per ticket below which a role is tuned. */
  roleTuneBelowFirstTryRate: number;
  /** Confirmed findings per unique finding below which the reviewers are tuned. */
  reviewerTuneBelowConfirmedRate: number;
  /** Items read with no idea accepted at which a substream is removed. */
  substreamRemoveAtItems: number;
  /** Failed sessions per load above which a skill is tuned. */
  skillTuneAboveFailedRate: number;
}

type Kind = 'runs' | 'amount' | 'rate' | 'hooks';

const KEYS: Record<keyof EvaluationConfig, Kind> = {
  zeroGuardRuns: 'runs',
  hookP95Ms: 'hooks',
  gateRemoveAtMinutes: 'amount',
  gateRemoveAtUsd: 'amount',
  gateTuneAboveFalseAlarmRate: 'rate',
  gateTuneAboveCouldNotRunRate: 'rate',
  roleTuneBelowFirstTryRate: 'rate',
  reviewerTuneBelowConfirmedRate: 'rate',
  substreamRemoveAtItems: 'amount',
  skillTuneAboveFailedRate: 'rate',
};

const isAmount = (v: unknown) => typeof v === 'number' && v >= 0;
const isHooks = (v: unknown) => !Array.isArray(v) && isAmount(Object(v).default) && Object.values(Object(v)).every(isAmount);

const KINDS: Record<Kind, [(v: unknown) => boolean, string]> = {
  runs: [(v) => Number.isInteger(v) && (v as number) >= 1, 'must be a whole number of 1 or more'],
  amount: [isAmount, 'must be a number of 0 or more'],
  rate: [(v) => typeof v === 'number' && v > 0 && v < 1, 'must be a number between 0 and 1'],
  hooks: [isHooks, 'must map default and hook names to milliseconds'],
};

const fail = (problem: string): never => {
  throw new Error(`config/evaluation.json${problem}`);
};

function objectOf(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail(' is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(' is not a JSON object');
  return value as Record<string, unknown>;
}

function read(text: string): EvaluationConfig {
  const { $comment: _, ...raw } = objectOf(text);
  const unknown = Object.keys(raw).find((k) => !(k in KEYS));
  if (unknown !== undefined) fail(`: unknown key ${unknown}`);
  for (const [key, kind] of Object.entries(KEYS)) {
    const [holds, wants] = KINDS[kind];
    if (!holds(raw[key])) fail(`: ${key} ${wants}`);
  }
  return raw as unknown as EvaluationConfig;
}

export function parseEvaluationConfig(text: string): { ok: true; config: EvaluationConfig } | { ok: false; error: string } {
  try {
    return { ok: true, config: read(text) };
  } catch (e) {
    // Only fail() throws in read().
    return { ok: false, error: (e as Error).message };
  }
}
