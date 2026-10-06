import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../host/process-result.ts';
import { DEFAULT_RULE, kubernetesConfigOf, type RollbackRule } from './config.ts';
import type { EnvironmentAdapter, ErrorRate } from './environment.ts';
import { cooldownBlock, judgeRelease, regresses, trafficWindow } from './incident.ts';
import { kubernetesEnvironment, type Runner, type Tool } from './kubernetes.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'kubernetes');
const ok = (name: string): ProcessResult => ({ status: 0, stdout: readFileSync(join(FIXTURES, name), 'utf8'), stderr: '' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LIVE = Date.UTC(2026, 9, 6, 8, 0, 0);
const NOW = LIVE + 10 * MINUTE;
const ON: RollbackRule = { ...DEFAULT_RULE, enabled: true };
const PROMETHEUS = { source: 'prometheus', namespace: 'monitoring', service: 'prometheus-operated', errors: 'sum(e)', requests: 'sum(r)' };

/**
 * The real Kubernetes adapter on recorded kubectl output: each errorRate reads the errors, then
 * the requests. The window has 42.5 5xx of 400 requests (10.6%), the hour before none, so the
 * release regresses; each rollback answers with the recorded `kubectl rollout undo`.
 */
function cluster(rollback: unknown, rollbacks = 2) {
  const calls: Array<[Tool, string[]]> = [];
  const answers: Record<string, ProcessResult[]> = {
    'kubectl get --raw': [0, 1].flatMap(() => [ok('prometheus-errors.json'), ok('prometheus-requests.json'), ok('prometheus-empty.json'), ok('prometheus-empty.json')]),
    'kubectl rollout undo': Array.from({ length: rollbacks }, () => ok('rollout-undo.txt')),
  };
  const run: Runner = (tool, args) => {
    calls.push([tool, args]);
    return answers[`${tool} ${args[0]} ${args[1]}`]!.shift()!;
  };
  const config = kubernetesConfigOf({ platform: 'kubernetes', productionNamespace: 'shop', metrics: PROMETHEUS, rollback });
  return { calls, env: kubernetesEnvironment(config, run, () => 0), rule: config.rollback };
}

const undos = (calls: Array<[Tool, string[]]>) => calls.filter(([, args]) => args[0] === 'rollout');

describe('judgeRelease on recorded kubectl output', () => {
  it('an error rate over the threshold with rollback off (the default) alerts only and rolls nothing back', () => {
    const { env, calls, rule } = cluster(undefined);
    const out = judgeRelease(env, 'web', LIVE, NOW, [], rule);
    expect(out).toEqual({
      action: 'alert',
      rule: 'regression-alert-only',
      message: 'web: 42.5 5xx of 400 requests in its first 10 min, 0 5xx in the 60 min before. Rollback is off in the project config; alert only.',
      history: [],
    });
    expect(undos(calls)).toEqual([]);
  });

  it('with rollback on, one rollback runs, and a second within 24 h is refused', () => {
    const { env, calls, rule } = cluster({ enabled: true });
    const first = judgeRelease(env, 'web', LIVE, NOW, [], rule);
    expect(first).toMatchObject({ action: 'rollback', rule: 'rolled-back', history: [{ release: 'web', at: NOW }] });
    expect(first.message).toMatch(/Rolled back: deployment\.apps\/web rolled back$/);
    const later = NOW + 23 * HOUR;
    const second = judgeRelease(env, 'web', later - 10 * MINUTE, later, first.history, rule);
    expect(second).toEqual({
      action: 'alert',
      rule: 'rollback-refused',
      message: expect.stringContaining('No rollback: an automatic rollback already ran in the last 24 h (web at 2026-10-06T08:10:00.000Z).'),
      history: first.history,
    });
    expect(undos(calls)).toEqual([['kubectl', ['rollout', 'undo', 'deployment/web', '-n', 'shop']]]);
  });

  it('reads the window and the hour before it, each through the metrics source', () => {
    const { env, calls, rule } = cluster(undefined);
    judgeRelease(env, 'web', LIVE, NOW, [], rule);
    const times = calls.map(([, args]) => /&time=(\d+)$/.exec(args[2]!)![1]);
    expect(times).toEqual([NOW, NOW, LIVE, LIVE].map((t) => String(t / 1000)));
    expect(calls[2]![1][2]).toContain(encodeURIComponent('sum(e)'));
  });
});

/** An adapter with fixed rates: the window's, then the hour before's. */
function fixed(current: ErrorRate, before: ErrorRate): EnvironmentAdapter & { rolledBack: string[] } {
  const rates = [current, before];
  const rolledBack: string[] = [];
  return {
    platform: 'kubernetes',
    previewUrl: () => '',
    ready: () => ({ ready: true, detail: '' }),
    errorRate: () => rates.shift()!,
    rollback: (release) => (rolledBack.push(release), { release, detail: 'done' }),
    cleanup: () => ({ removed: [] }),
    rolledBack,
  };
}

describe('judgeRelease', () => {
  it('rolls back once the cooldown has passed', () => {
    const env = fixed({ errors: 50, requests: 100 }, { errors: 0, requests: 600 });
    const past = [{ release: 'web', at: NOW - 24 * HOUR - 1 }];
    expect(judgeRelease(env, 'web', LIVE, NOW, past, ON)).toMatchObject({ action: 'rollback', history: [...past, { release: 'web', at: NOW }] });
    expect(env.rolledBack).toEqual(['web']);
  });

  it('is healthy, with the evidence, when the rate stays under the rule', () => {
    const env = fixed({ errors: 9, requests: 100 }, { errors: 0, requests: 600 });
    expect(judgeRelease(env, 'web', LIVE, NOW, [], ON)).toEqual({ action: 'none', rule: 'healthy', message: 'web: 9 5xx of 100 requests in its first 10 min, 0 5xx in the 60 min before', history: [] });
    expect(env.rolledBack).toEqual([]);
  });

  it('judges nothing outside the window', () => {
    const env = fixed({ errors: 50, requests: 100 }, { errors: 0, requests: 1 });
    expect(judgeRelease(env, 'web', LIVE, LIVE + 4 * MINUTE, [], ON)).toEqual({ action: 'none', rule: 'outside-window', message: 'web is not in its first 30 min after 5 min of traffic', history: [] });
  });

  it('alerts, never rolls back, when the metrics cannot be read', () => {
    const env = fixed({ errors: 50, requests: 100 }, { errors: 0, requests: 1 });
    env.errorRate = () => {
      throw new Error('no metrics source configured');
    };
    expect(judgeRelease(env, 'web', LIVE, NOW, [], ON)).toEqual({ action: 'alert', rule: 'metrics-unreadable', message: 'Cannot read the error rate of web: no metrics source configured. Alert only.', history: [] });
    expect(env.rolledBack).toEqual([]);
  });

  it('gives the window length it judged in the message', () => {
    const env = fixed({ errors: 1, requests: 100 }, { errors: 0, requests: 1 });
    expect(judgeRelease(env, 'web', LIVE, LIVE + 7 * MINUTE, [], ON).message).toContain('in its first 7 min');
  });
});

describe('trafficWindow', () => {
  it('is the first window minutes, or less when less has passed, from min traffic to max since live', () => {
    expect(trafficWindow(LIVE, LIVE + 5 * MINUTE - 1, ON)).toBeUndefined();
    expect(trafficWindow(LIVE, LIVE + 5 * MINUTE, ON)).toEqual({ start: LIVE, end: LIVE + 5 * MINUTE });
    expect(trafficWindow(LIVE, LIVE + 30 * MINUTE, ON)).toEqual({ start: LIVE, end: LIVE + 10 * MINUTE });
    expect(trafficWindow(LIVE, LIVE + 30 * MINUTE + 1, ON)).toBeUndefined();
  });
});

describe('regresses', () => {
  const W = { start: 0, end: 10 * MINUTE };

  it('needs the count, the ratio and the baseline floor all at once, each inclusive', () => {
    expect(regresses({ errors: 10, requests: 200 }, { errors: 0, requests: 0 }, W, ON)).toBe(true);
    expect(regresses({ errors: 9, requests: 10 }, { errors: 0, requests: 0 }, W, ON)).toBe(false);
    expect(regresses({ errors: 10, requests: 201 }, { errors: 0, requests: 0 }, W, ON)).toBe(false);
    expect(regresses({ errors: 9, requests: 10 }, { errors: 0, requests: 0 }, W, { ...ON, baselineMargin: 1 })).toBe(false);
    expect(regresses({ errors: 10, requests: 10 }, { errors: 0, requests: 0 }, W, { ...ON, baselineMargin: 1 })).toBe(true);
  });

  it('scales by the window length, wherever the window starts', () => {
    const later = { start: LIVE, end: LIVE + 10 * MINUTE };
    expect(regresses({ errors: 30, requests: 100 }, { errors: 60, requests: 0 }, later, ON)).toBe(true);
    expect(regresses({ errors: 29, requests: 100 }, { errors: 60, requests: 0 }, later, ON)).toBe(false);
  });

  it('scales the baseline to the window: 3x when that is above baseline + 10', () => {
    // 60 5xx in the hour before is 10 in 10 min: the floor is max(30, 20) = 30.
    expect(regresses({ errors: 30, requests: 100 }, { errors: 60, requests: 0 }, W, ON)).toBe(true);
    expect(regresses({ errors: 29, requests: 100 }, { errors: 60, requests: 0 }, W, ON)).toBe(false);
  });

  it('uses baseline + margin when that is the higher floor', () => {
    // 24 in the hour is 4 in 10 min: max(12, 14) = 14.
    expect(regresses({ errors: 14, requests: 100 }, { errors: 24, requests: 0 }, W, ON)).toBe(true);
    expect(regresses({ errors: 13, requests: 100 }, { errors: 24, requests: 0 }, W, ON)).toBe(false);
  });
});

describe('cooldownBlock', () => {
  it('blocks up to and including the cooldown, and names the last rollback', () => {
    const past = [{ release: 'web', at: LIVE }];
    expect(cooldownBlock(past, LIVE + 24 * HOUR, ON)).toBe('an automatic rollback already ran in the last 24 h (web at 2026-10-06T08:00:00.000Z)');
    expect(cooldownBlock(past, LIVE + 24 * HOUR + 1, ON)).toBeUndefined();
    expect(cooldownBlock([], LIVE, ON)).toBeUndefined();
  });
});
