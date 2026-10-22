// config/workflow.yaml: every flow-control number the dispatcher uses, as data, read without a
// YAML library. Flat `key: value` lines. Anything missing, unknown or malformed is an error, never
// a default: the dispatcher then does not start.

export interface WorkflowConfig {
  controllers: number;
  ticketsPerRun: number;
  stopGateBlocks: number;
  identicalCalls: number;
  wallClockMinutes: number;
  retriesPerTicket: number;
  contextHandoffRatio: number;
  reviewFixRounds: number;
  budgetUsd: number;
  incidentPollMinutes: number;
  retryContextOverflow: number;
  retryNetwork: number;
  retryToolError: number;
  retryUnknown: number;
  retryCiFlake: number;
  planRepairRounds: number;
  /** Gate metrics (ticket 15b): false alarms per failure above which a gate becomes a lesson. */
  gateFalseAlarmRate: number;
  /** Could-not-run (exit 2) per run above which a gate becomes a lesson. */
  gateCouldNotRunRate: number;
  /** A gate with no fail in its last this many runs is dead. */
  gateDeadWindowRuns: number;
  /** Runs a gate needs before its rates are judged. */
  gateMinRuns: number;
  /** Escapes a gate (or no gate) may have before it becomes a lesson. */
  gateEscapes: number;
  /** Days between two canary runs of every gate's prove-it-bites test. */
  canaryEveryDays: number;
  /** Cloud sessions at once across the run's controllers (ticket 25, decision 20). */
  cloudSessions: number;
  /** Wall clock per cloud role session; one that has not pushed and gone idle by then escalates. */
  cloudRoleMinutes: number;
  /**
   * Extra cleaner rounds per ticket when the hardener fails on complexity alone (ticket 39) or
   * only on equivalent mutants it wrote SIMPLIFY edits for (ticket 40); one budget for both.
   */
  cleanerRounds: number;
}

/** What went wrong with a ticket attempt, as the retry table reads it. */
export type FailureClass = 'usage-limit' | 'context-overflow' | 'network' | 'tool-error' | 'ci-flake' | 'unknown';

export type WorkflowConfigResult = { ok: true; config: WorkflowConfig } | { ok: false; error: string };

type Kind = 'count' | 'retries' | 'ratio' | 'usd';

const KEYS: Record<string, [keyof WorkflowConfig, Kind]> = {
  controllers_at_once: ['controllers', 'count'],
  tickets_per_controller_run: ['ticketsPerRun', 'count'],
  stop_gate_blocks: ['stopGateBlocks', 'count'],
  identical_calls_before_escalating: ['identicalCalls', 'count'],
  wall_clock_minutes_per_ticket: ['wallClockMinutes', 'count'],
  retries_per_ticket: ['retriesPerTicket', 'retries'],
  context_handoff_ratio: ['contextHandoffRatio', 'ratio'],
  review_fix_rounds: ['reviewFixRounds', 'retries'],
  budget_usd_per_run: ['budgetUsd', 'usd'],
  incident_poll_minutes: ['incidentPollMinutes', 'count'],
  retry_context_overflow: ['retryContextOverflow', 'retries'],
  retry_network: ['retryNetwork', 'retries'],
  retry_tool_error: ['retryToolError', 'retries'],
  retry_unknown: ['retryUnknown', 'retries'],
  retry_ci_flake: ['retryCiFlake', 'retries'],
  plan_repair_rounds: ['planRepairRounds', 'retries'],
  gate_false_alarm_rate: ['gateFalseAlarmRate', 'ratio'],
  gate_could_not_run_rate: ['gateCouldNotRunRate', 'ratio'],
  gate_dead_window_runs: ['gateDeadWindowRuns', 'count'],
  gate_min_runs: ['gateMinRuns', 'count'],
  gate_escapes_before_lesson: ['gateEscapes', 'count'],
  canary_every_days: ['canaryEveryDays', 'count'],
  cloud_sessions_at_once: ['cloudSessions', 'count'],
  cloud_role_minutes: ['cloudRoleMinutes', 'count'],
  cleaner_rounds: ['cleanerRounds', 'retries'],
};

/** Old names still read under their new ones (ticket 40: complexity_rounds became cleaner_rounds). */
const RENAMED: Record<string, string> = { complexity_rounds: 'cleaner_rounds' };

/** A line's key under its current name, with its field and kind. */
function entry(name: string): [string, [keyof WorkflowConfig, Kind]] {
  const key = RENAMED[name] ?? name;
  return [key, KEYS[key] ?? fail(`unknown key ${name}`)];
}

const LINE = /^([a-z0-9_]+):(.*)/;

const WHOLE = /^\d+$/;
const DECIMAL = /^\d*\.?\d+$/;

// Each kind: the shape a value must have, a check on its number, and how the error describes it.
const KINDS: Record<Kind, { shape: RegExp; ok: (n: number) => boolean; wants: string }> = {
  count: { shape: WHOLE, ok: (n) => n >= 1, wants: 'a whole number of 1 or more' },
  retries: { shape: WHOLE, ok: () => true, wants: 'a whole number' },
  ratio: { shape: DECIMAL, ok: (n) => n > 0 && n < 1, wants: 'a number between 0 and 1' },
  usd: { shape: DECIMAL, ok: (n) => n > 0, wants: 'a positive number' },
};

const fail = (problem: string): never => {
  throw new Error(`config/workflow.yaml: ${problem}`);
};

/** The `key: value` pairs, comments and blank lines dropped. */
function pairs(text: string): [string, string][] {
  const lines = text.split('\n').map((line) => line.replace(/#.*/, '').trim());
  return lines.filter(Boolean).map((line) => {
    const match = LINE.exec(line) ?? fail(`cannot read line "${line}"`);
    return [match[1], match[2].trim()];
  });
}

function value(key: string, kind: Kind, raw: string): number {
  const rule = KINDS[kind];
  const n = Number(raw);
  if (!rule.shape.test(raw) || !rule.ok(n)) fail(`${key} must be ${rule.wants}, got "${raw}"`);
  return n;
}

function read(text: string): WorkflowConfig {
  const config: Partial<WorkflowConfig> = {};
  for (const [name, raw] of pairs(text)) {
    const [key, [field, kind]] = entry(name);
    if (field in config) fail(`${key} is set twice`);
    config[field] = value(name, kind, raw);
  }
  for (const [key, [field]] of Object.entries(KEYS)) if (!(field in config)) fail(`missing ${key}`);
  return config as WorkflowConfig;
}

export function parseWorkflowConfig(text: string): WorkflowConfigResult {
  try {
    return { ok: true, config: read(text) };
  } catch (e) {
    // Only fail() throws in read().
    return { ok: false, error: (e as Error).message };
  }
}

/** Retries the retry table allows for a failure class. A usage limit is never retried. */
export function retryLimit(config: WorkflowConfig, failure: FailureClass): number {
  const table: Record<FailureClass, number> = {
    'usage-limit': 0,
    'context-overflow': config.retryContextOverflow,
    network: config.retryNetwork,
    'tool-error': config.retryToolError,
    'ci-flake': config.retryCiFlake,
    unknown: config.retryUnknown,
  };
  return table[failure];
}
