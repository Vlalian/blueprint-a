// The incident rule on Kubernetes (ticket 55): Blueprint B's rule (decision 5) on the environment
// adapter. A production release that went live within maxMinutesSinceLive and has served at least
// minMinutesOfTraffic is judged on its first windowMinutes: at least min5xxCount 5xx, at least
// min5xxRatio of its requests 5xx, and at least max(baselineMultiplier x baseline, baseline +
// baselineMargin), the baseline being the release's 5xx over the baselineMinutes before it went
// live (the previous revision's traffic), scaled to the window. A regression is an alert only
// unless the project config turns rollback on; then one rollback runs, and another within
// cooldownHours (never under 24) is refused and alerted. Metrics that cannot be read are an alert,
// never a rollback. The caller keeps the rollback history and passes it back in.

import type { RollbackRule } from './config.ts';
import type { EnvironmentAdapter, ErrorRate, Window } from './environment.ts';

export interface PastRollback {
  release: string;
  at: number;
}

export type Action = 'none' | 'alert' | 'rollback';

export interface Outcome {
  action: Action;
  rule: string;
  message: string;
  /** The history with this run's rollback added, if one ran. */
  history: PastRollback[];
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** The first minutes of traffic, or undefined while too early or too late to judge. */
export function trafficWindow(liveAt: number, now: number, rule: RollbackRule): Window | undefined {
  const live = now - liveAt;
  if (live < rule.minMinutesOfTraffic * MINUTE || live > rule.maxMinutesSinceLive * MINUTE) return undefined;
  return { start: liveAt, end: liveAt + Math.min(rule.windowMinutes * MINUTE, live) };
}

/** Whether the window's 5xx are a regression against the baseline, scaled to the window's length. */
export function regresses(current: ErrorRate, before: ErrorRate, window: Window, rule: RollbackRule): boolean {
  const baseline = (before.errors * (window.end - window.start)) / (rule.baselineMinutes * MINUTE);
  const floor = Math.max(rule.baselineMultiplier * baseline, baseline + rule.baselineMargin);
  return current.errors >= rule.min5xxCount && current.errors >= current.requests * rule.min5xxRatio && current.errors >= floor;
}

/** Why another automatic rollback may not run now; undefined when it may. */
export function cooldownBlock(history: PastRollback[], now: number, rule: RollbackRule): string | undefined {
  const recent = history.find((r) => now - r.at <= rule.cooldownHours * HOUR);
  return recent && `an automatic rollback already ran in the last ${rule.cooldownHours} h (${recent.release} at ${new Date(recent.at).toISOString()})`;
}

const outcome = (action: Action, rule: string, message: string, history: PastRollback[]): Outcome => ({ action, rule, message, history });

function readRates(env: EnvironmentAdapter, release: string, window: Window, rule: RollbackRule): [ErrorRate, ErrorRate] {
  const before = { start: window.start - rule.baselineMinutes * MINUTE, end: window.start };
  return [env.errorRate(release, window), env.errorRate(release, before)];
}

function act(env: EnvironmentAdapter, release: string, evidence: string, history: PastRollback[], now: number, rule: RollbackRule): Outcome {
  if (!rule.enabled) return outcome('alert', 'regression-alert-only', `${evidence}. Rollback is off in the project config; alert only.`, history);
  const blocked = cooldownBlock(history, now, rule);
  if (blocked) return outcome('alert', 'rollback-refused', `${evidence}. No rollback: ${blocked}.`, history);
  const done = env.rollback(release);
  return outcome('rollback', 'rolled-back', `${evidence}. Rolled back: ${done.detail}`, [...history, { release, at: now }]);
}

/** Judges one production release that went live at liveAt; rolls it back only when the config allows and the cooldown has passed. */
export function judgeRelease(env: EnvironmentAdapter, release: string, liveAt: number, now: number, history: PastRollback[], rule: RollbackRule): Outcome {
  const window = trafficWindow(liveAt, now, rule);
  if (!window) return outcome('none', 'outside-window', `${release} is not in its first ${rule.maxMinutesSinceLive} min after ${rule.minMinutesOfTraffic} min of traffic`, history);
  let rates: [ErrorRate, ErrorRate];
  try {
    rates = readRates(env, release, window, rule);
  } catch (e) {
    return outcome('alert', 'metrics-unreadable', `Cannot read the error rate of ${release}: ${(e as Error).message}. Alert only.`, history);
  }
  const [current, before] = rates;
  const evidence = `${release}: ${current.errors} 5xx of ${current.requests} requests in its first ${(window.end - window.start) / MINUTE} min, ${before.errors} 5xx in the ${rule.baselineMinutes} min before`;
  if (!regresses(current, before, window, rule)) return outcome('none', 'healthy', evidence, history);
  return act(env, release, evidence, history, now, rule);
}
