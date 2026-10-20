// Where a project's previews live and how its incidents are judged (ticket 55): projects/<name>/
// project.json "preview" with "platform": "kubernetes". Everything but the production namespace has
// a default; anything unknown or malformed is an error, never a guess. Rollback is off unless
// "rollback": { "enabled": true }, and then follows Blueprint B's incident rule (decision 5) with
// its numbers as defaults: at most one automatic rollback a day, so the cooldown is never shorter
// than 24 h.

export interface RollbackRule {
  enabled: boolean;
  maxMinutesSinceLive: number;
  minMinutesOfTraffic: number;
  windowMinutes: number;
  min5xxCount: number;
  min5xxRatio: number;
  baselineMinutes: number;
  baselineMultiplier: number;
  baselineMargin: number;
  cooldownHours: number;
}

/** Prometheus' HTTP API reached through the API server's service proxy; none reads no metrics. */
export type MetricsConfig =
  | { source: 'none' }
  | { source: 'prometheus'; namespace: string; service: string; port: string; errors: string; requests: string };

export interface KubernetesConfig {
  /** namespace: one namespace per branch; helm: one Helm release per branch in a shared namespace. */
  mode: 'namespace' | 'helm';
  /** The start of every preview namespace or release name. */
  prefix: string;
  /** helm mode: the shared namespace the preview releases are installed in. */
  namespace: string;
  /** helm mode: the label that selects a release's objects. */
  instanceLabel: string;
  /** The Ingress whose host is the preview address; the only one when not set. */
  ingress: string | undefined;
  readyTimeoutSeconds: number;
  /** Where the production releases run that errorRate and rollback act on. */
  productionNamespace: string;
  /** Branches that never get a preview cleaned up. */
  protectedBranches: string[];
  metrics: MetricsConfig;
  rollback: RollbackRule;
}

export const DEFAULT_RULE: RollbackRule = {
  enabled: false,
  maxMinutesSinceLive: 30,
  minMinutesOfTraffic: 5,
  windowMinutes: 10,
  min5xxCount: 10,
  min5xxRatio: 0.05,
  baselineMinutes: 60,
  baselineMultiplier: 3,
  baselineMargin: 10,
  cooldownHours: 24,
};

type Obj = Record<string, unknown>;

const fail = (problem: string): never => {
  throw new Error(`"preview": ${problem}`);
};

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const PREFIX = /^[a-z][-a-z0-9]{0,19}$/;
const LABEL_KEY = /^([a-z0-9.-]+\/)?[A-Za-z0-9][-A-Za-z0-9_.]*$/;

function object(value: unknown, where: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${where} must be an object`);
  return value as Obj;
}

function known(o: Obj, keys: string[], where: string): Obj {
  const unknown = Object.keys(o).find((k) => !keys.includes(k));
  if (unknown !== undefined) fail(`${where} has an unknown key "${unknown}"`);
  return o;
}

function text(o: Obj, key: string, pattern: RegExp, fallback?: string): string {
  const value = o[key] ?? fallback ?? fail(`"${key}" is required`);
  if (typeof value !== 'string' || !pattern.test(value)) fail(`"${key}" must match ${pattern}, not ${JSON.stringify(value)}`);
  return value as string;
}

const optional = (o: Obj, key: string, pattern: RegExp) => (o[key] === undefined ? undefined : text(o, key, pattern));

function number(o: Obj, key: string, fallback: number, ok: (n: number) => boolean): number {
  const value = o[key] ?? fallback;
  if (typeof value !== 'number' || !ok(value)) fail(`"${key}" is out of range: ${JSON.stringify(value)}`);
  return value as number;
}

const positive = (n: number) => n > 0;
const ratio = (n: number) => n > 0 && n < 1;
const day = (n: number) => n >= 24;

const RULE_CHECKS: Record<Exclude<keyof RollbackRule, 'enabled'>, (n: number) => boolean> = {
  maxMinutesSinceLive: positive,
  minMinutesOfTraffic: positive,
  windowMinutes: positive,
  min5xxCount: positive,
  min5xxRatio: ratio,
  baselineMinutes: positive,
  baselineMultiplier: positive,
  baselineMargin: positive,
  cooldownHours: day,
};

function rule(value: unknown): RollbackRule {
  const o = known(object(value ?? {}, '"rollback"'), Object.keys(DEFAULT_RULE), '"rollback"');
  if (o.enabled !== undefined && typeof o.enabled !== 'boolean') fail('"enabled" must be true or false');
  const numbers = Object.entries(RULE_CHECKS).map(([k, ok]) => [k, number(o, k, DEFAULT_RULE[k as keyof typeof RULE_CHECKS], ok)]);
  return { enabled: o.enabled === true, ...Object.fromEntries(numbers) } as RollbackRule;
}

const ANY = /\S/;
const PROMETHEUS_KEYS = ['source', 'namespace', 'service', 'port', 'errors', 'requests'];

function metrics(value: unknown): MetricsConfig {
  const o = object(value ?? { source: 'none' }, '"metrics"');
  if (o.source === 'none') return { source: 'none' };
  if (o.source !== 'prometheus') fail(`"metrics" "source" is none or prometheus, not ${JSON.stringify(o.source)}`);
  known(o, PROMETHEUS_KEYS, '"metrics"');
  return { source: 'prometheus', namespace: text(o, 'namespace', DNS_LABEL), service: text(o, 'service', DNS_LABEL), port: text(o, 'port', /^[a-z0-9-]+$/, '9090'), errors: text(o, 'errors', ANY), requests: text(o, 'requests', ANY) };
}

function branches(value: unknown): string[] {
  const list = value ?? ['main', 'master', 'dev', 'develop'];
  if (!Array.isArray(list) || !list.every((b) => typeof b === 'string')) fail('"protectedBranches" must be a list of branch names');
  return list as string[];
}

const KEYS = ['platform', 'mode', 'prefix', 'namespace', 'instanceLabel', 'ingress', 'readyTimeoutSeconds', 'productionNamespace', 'protectedBranches', 'metrics', 'rollback'];

function mode(o: Obj): KubernetesConfig['mode'] {
  const m = o.mode ?? 'namespace';
  if (m !== 'namespace' && m !== 'helm') fail(`"mode" is namespace or helm, not ${JSON.stringify(m)}`);
  return m as KubernetesConfig['mode'];
}

/** A project's "preview" block; throws, naming the key, on anything it cannot read. */
export function kubernetesConfigOf(preview: unknown): KubernetesConfig {
  const o = known(object(preview, '"preview"'), KEYS, '"preview"');
  if (o.platform !== 'kubernetes') fail(`"platform" is kubernetes, not ${JSON.stringify(o.platform)}`);
  const m = mode(o);
  return {
    mode: m,
    prefix: text(o, 'prefix', PREFIX, 'preview-'),
    namespace: m === 'helm' ? text(o, 'namespace', DNS_LABEL) : '',
    instanceLabel: text(o, 'instanceLabel', LABEL_KEY, 'app.kubernetes.io/instance'),
    ingress: optional(o, 'ingress', DNS_LABEL),
    readyTimeoutSeconds: number(o, 'readyTimeoutSeconds', 300, positive),
    productionNamespace: text(o, 'productionNamespace', DNS_LABEL),
    protectedBranches: branches(o.protectedBranches),
    metrics: metrics(o.metrics),
    rollback: rule(o.rollback),
  };
}
