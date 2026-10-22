import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWorkflowConfig, retryLimit } from './workflow-config.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SHIPPED = readFileSync(join(ROOT, 'config', 'workflow.yaml'), 'utf8');

const VALID = [
  'controllers_at_once: 2',
  'tickets_per_controller_run: 2',
  'stop_gate_blocks: 2',
  'identical_calls_before_escalating: 5',
  'wall_clock_minutes_per_ticket: 90',
  'retries_per_ticket: 2',
  'context_handoff_ratio: 0.7',
  'review_fix_rounds: 2',
  'budget_usd_per_run: 50',
  'incident_poll_minutes: 5',
  'retry_context_overflow: 1',
  'retry_network: 2',
  'retry_tool_error: 1',
  'retry_unknown: 1',
  'retry_ci_flake: 1',
  'plan_repair_rounds: 2',
  'gate_false_alarm_rate: 0.3',
  'gate_could_not_run_rate: 0.1',
  'gate_dead_window_runs: 30',
  'gate_min_runs: 10',
  'gate_escapes_before_lesson: 1',
  'canary_every_days: 7',
  'cloud_sessions_at_once: 3',
  'cloud_role_minutes: 60',
  'cleaner_rounds: 1',
].join('\n');

const without = (key: string) => VALID.split('\n').filter((line) => !line.startsWith(`${key}:`)).join('\n');
const replaced = (key: string, value: string) =>
  VALID.split('\n').map((line) => (line.startsWith(`${key}:`) ? `${key}: ${value}` : line)).join('\n');
const error = (problem: string) => ({ ok: false, error: `config/workflow.yaml: ${problem}` });

const DEFAULTS = {
  controllers: 2,
  ticketsPerRun: 2,
  stopGateBlocks: 2,
  identicalCalls: 5,
  wallClockMinutes: 90,
  retriesPerTicket: 2,
  contextHandoffRatio: 0.7,
  reviewFixRounds: 2,
  budgetUsd: 50,
  incidentPollMinutes: 5,
  retryContextOverflow: 1,
  retryNetwork: 2,
  retryToolError: 1,
  retryUnknown: 1,
  retryCiFlake: 1,
  planRepairRounds: 2,
  gateFalseAlarmRate: 0.3,
  gateCouldNotRunRate: 0.1,
  gateDeadWindowRuns: 30,
  gateMinRuns: 10,
  gateEscapes: 1,
  canaryEveryDays: 7,
  cloudSessions: 3,
  cloudRoleMinutes: 60,
  cleanerRounds: 1,
};

describe('parseWorkflowConfig', () => {
  it("reads the shipped config: the spec's defaults", () => {
    expect(parseWorkflowConfig(SHIPPED)).toEqual({ ok: true, config: { ...DEFAULTS, cleanerRounds: 2 } });
  });

  it('ignores comments, blank lines and Windows line endings', () => {
    const text = `# header\n\n${VALID.replace('retries_per_ticket: 2', 'retries_per_ticket: 3 # more')}\n`.replaceAll('\n', '\r\n');
    expect(parseWorkflowConfig(text)).toEqual({ ok: true, config: { ...DEFAULTS, retriesPerTicket: 3 } });
  });

  it('fails closed without plan_repair_rounds, and reads 0 as no repair round', () => {
    expect(parseWorkflowConfig(without('plan_repair_rounds'))).toEqual(error('missing plan_repair_rounds'));
    expect(parseWorkflowConfig(replaced('plan_repair_rounds', '0'))).toEqual({ ok: true, config: { ...DEFAULTS, planRepairRounds: 0 } });
  });

  it.each(['gate_false_alarm_rate', 'gate_could_not_run_rate', 'gate_dead_window_runs', 'gate_min_runs', 'gate_escapes_before_lesson', 'canary_every_days'])(
    'fails closed without the gate threshold %s',
    (key) => {
      expect(parseWorkflowConfig(without(key))).toEqual(error(`missing ${key}`));
    },
  );

  it('reads the gate thresholds as rates between 0 and 1 and the windows as counts of 1 or more', () => {
    expect(parseWorkflowConfig(replaced('gate_false_alarm_rate', '1'))).toEqual(error('gate_false_alarm_rate must be a number between 0 and 1, got "1"'));
    expect(parseWorkflowConfig(replaced('gate_could_not_run_rate', '0'))).toEqual(error('gate_could_not_run_rate must be a number between 0 and 1, got "0"'));
    expect(parseWorkflowConfig(replaced('gate_dead_window_runs', '0'))).toEqual(error('gate_dead_window_runs must be a whole number of 1 or more, got "0"'));
    expect(parseWorkflowConfig(replaced('gate_min_runs', '0'))).toEqual(error('gate_min_runs must be a whole number of 1 or more, got "0"'));
    expect(parseWorkflowConfig(replaced('gate_escapes_before_lesson', '0'))).toEqual(error('gate_escapes_before_lesson must be a whole number of 1 or more, got "0"'));
    expect(parseWorkflowConfig(replaced('canary_every_days', '0'))).toEqual(error('canary_every_days must be a whole number of 1 or more, got "0"'));
  });

  it.each(['cloud_sessions_at_once', 'cloud_role_minutes'])('fails closed without the cloud limit %s (ticket 25), and reads it as a count of 1 or more', (key) => {
    expect(parseWorkflowConfig(without(key))).toEqual(error(`missing ${key}`));
    expect(parseWorkflowConfig(replaced(key, '0'))).toEqual(error(`${key} must be a whole number of 1 or more, got "0"`));
  });

  it('fails closed without cleaner_rounds (tickets 39, 40), and reads 0 as no extra cleaner round', () => {
    expect(parseWorkflowConfig(without('cleaner_rounds'))).toEqual(error('missing cleaner_rounds'));
    expect(parseWorkflowConfig(replaced('cleaner_rounds', '0'))).toEqual({ ok: true, config: { ...DEFAULTS, cleanerRounds: 0 } });
  });

  it('still reads the old name complexity_rounds (ticket 40), but not both names at once', () => {
    const old = VALID.replace('cleaner_rounds: 1', 'complexity_rounds: 2');
    expect(parseWorkflowConfig(old)).toEqual({ ok: true, config: { ...DEFAULTS, cleanerRounds: 2 } });
    expect(parseWorkflowConfig(VALID.replace('cleaner_rounds: 1', 'complexity_rounds: x'))).toEqual(error('complexity_rounds must be a whole number, got "x"'));
    expect(parseWorkflowConfig(`${VALID}\ncomplexity_rounds: 1`)).toEqual(error('cleaner_rounds is set twice'));
  });

  it('fails closed on a missing key', () => {
    expect(parseWorkflowConfig(without('wall_clock_minutes_per_ticket'))).toEqual(error('missing wall_clock_minutes_per_ticket'));
  });

  it('fails closed on an unknown key, so a typo cannot drop a number', () => {
    expect(parseWorkflowConfig(`${VALID}\nwall_clock_minuts: 3`)).toEqual(error('unknown key wall_clock_minuts'));
  });

  it('fails closed on a key set twice', () => {
    expect(parseWorkflowConfig(`${VALID}\nretry_network: 3`)).toEqual(error('retry_network is set twice'));
  });

  it.each(['just words', 'Controllers: 3', ' : 3', 'x-y: 3'])('fails closed on a line that is not a lower-case key: value (%j)', (line) => {
    expect(parseWorkflowConfig(`${VALID}\n${line}`)).toEqual(error(`cannot read line "${line.trim()}"`));
  });

  it.each(['0', '-1', '1.5', 'two', '', '2x', 'x2', '2e1', '+2', '0x2'])('fails closed when a count is %j instead of a whole number of 1 or more', (value) => {
    expect(parseWorkflowConfig(replaced('controllers_at_once', value))).toEqual(
      error(`controllers_at_once must be a whole number of 1 or more, got "${value}"`),
    );
  });

  it('accepts a count of 1', () => {
    const result = parseWorkflowConfig(replaced('controllers_at_once', '1'));
    expect(result.ok && result.config.controllers).toBe(1);
  });

  it('accepts 0 retries for a failure class, which means never retry it', () => {
    const result = parseWorkflowConfig(replaced('retry_unknown', '0'));
    expect(result.ok && result.config.retryUnknown).toBe(0);
  });

  it.each(['-1', '0.5', 'once', '', '1x', '1e1', '+1'])('fails closed when a retry count is %j instead of a whole number', (value) => {
    expect(parseWorkflowConfig(replaced('retry_network', value))).toEqual(error(`retry_network must be a whole number, got "${value}"`));
  });

  it.each(['0', '1', '1.2', 'x', '', '0.7x', 'x0.7', '+0.5', '5e-1', '.5e0'])('fails closed when a ratio is %j instead of a number between 0 and 1', (value) => {
    expect(parseWorkflowConfig(replaced('context_handoff_ratio', value))).toEqual(
      error(`context_handoff_ratio must be a number between 0 and 1, got "${value}"`),
    );
  });

  it('reads a ratio with or without a leading zero', () => {
    const result = parseWorkflowConfig(replaced('context_handoff_ratio', '.5'));
    expect(result.ok && result.config.contextHandoffRatio).toBe(0.5);
    const two = parseWorkflowConfig(replaced('context_handoff_ratio', '0.75'));
    expect(two.ok && two.config.contextHandoffRatio).toBe(0.75);
  });

  it('reads a budget in dollars and cents', () => {
    const result = parseWorkflowConfig(replaced('budget_usd_per_run', '12.5'));
    expect(result.ok && result.config.budgetUsd).toBe(12.5);
  });

  it.each(['0', '-3', 'lots', '', '5$', '$5', '5e1', '+5', '0x5'])('fails closed when the budget is %j instead of a positive amount', (value) => {
    expect(parseWorkflowConfig(replaced('budget_usd_per_run', value))).toEqual(
      error(`budget_usd_per_run must be a positive number, got "${value}"`),
    );
  });
});

describe('retryLimit', () => {
  it('reads the retry table: one number per failure class, none for a usage limit', () => {
    const config = { ...DEFAULTS, retryContextOverflow: 3, retryNetwork: 4, retryToolError: 5, retryUnknown: 6, retryCiFlake: 7 };
    expect(['context-overflow', 'network', 'tool-error', 'unknown', 'ci-flake', 'usage-limit'].map((c) => retryLimit(config, c as never))).toEqual([
      3, 4, 5, 6, 7, 0,
    ]);
  });
});
