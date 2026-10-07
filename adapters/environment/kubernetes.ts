// The Kubernetes environment adapter (ticket 55). Every call is kubectl (or Helm, in helm mode)
// through an injected runner, so tests play back recorded output and never reach a cluster. A
// branch's preview is a namespace of its own (namespace mode) or a Helm release in a shared
// namespace (helm mode), named by names.ts; its address is the host of its Ingress; it is ready
// when `kubectl rollout status` finishes for each of its Deployments within the configured timeout.
// The error rate comes from Prometheus' HTTP API through the API server's service proxy
// (`kubectl get --raw`), with the queries from the project config. Sources and what is unverified:
// README.md beside this file.

import type { ProcessResult } from '../host/process-result.ts';
import type { KubernetesConfig, MetricsConfig } from './config.ts';
import type { EnvironmentAdapter, ErrorRate, Readiness, Window } from './environment.ts';
import { previewName } from './names.ts';

export type Tool = 'kubectl' | 'helm';
export type Runner = (tool: Tool, args: string[]) => ProcessResult;

/** The annotation a preview namespace carries with the exact branch it was made for. */
export const BRANCH_ANNOTATION = 'blueprint-a/branch';

const NAMESPACE_MAX = 63;
const RELEASE_MAX = 53;
const RELEASE = /^[a-z0-9]([-a-z0-9]{0,51}[a-z0-9])?$/;

/** Why a command failed: what it said, else the spawn error, else its exit code. */
const said = (r: ProcessResult) => (r.stderr || r.error?.message || `exit ${r.status}`).trim();

/** stdout, or a throw naming the command and why it failed. */
function output(r: ProcessResult, tool: Tool, args: string[]): string {
  if (r.status !== 0) throw new Error(`${tool} ${args.slice(0, 2).join(' ')} failed: ${said(r)}`);
  return r.stdout;
}

interface Target {
  namespace: string;
  /** The namespace (namespace mode) or the Helm release (helm mode) that is the branch's preview. */
  name: string;
  selector: string[];
}

function targetOf(config: KubernetesConfig, branch: string): Target {
  if (config.mode === 'namespace') {
    const namespace = previewName(config.prefix, branch, NAMESPACE_MAX);
    return { namespace, name: namespace, selector: [] };
  }
  const release = previewName(config.prefix, branch, RELEASE_MAX);
  return { namespace: config.namespace, name: release, selector: ['-l', `${config.instanceLabel}=${release}`] };
}

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function rollouts(t: Target, deployments: string[], deadline: number, timeout: number, run: Runner, now: () => number): Readiness {
  for (const name of deployments) {
    const left = Math.ceil((deadline - now()) / 1000);
    if (left <= 0) return { ready: false, detail: `timed out after ${timeout}s, before ${name} rolled out` };
    const r = run('kubectl', ['rollout', 'status', name, '-n', t.namespace, `--timeout=${left}s`]);
    if (r.status !== 0) return { ready: false, detail: `${name} not rolled out: ${said(r)}` };
  }
  return { ready: true, detail: `${deployments.join(', ')} rolled out in ${t.namespace}` };
}

function ready(config: KubernetesConfig, branch: string, run: Runner, now: () => number): Readiness {
  const deadline = now() + config.readyTimeoutSeconds * 1000;
  const t = targetOf(config, branch);
  const args = ['get', 'deployments', '-n', t.namespace, ...t.selector, '-o', 'name'];
  const deployments = lines(output(run('kubectl', args), 'kubectl', args));
  if (deployments.length === 0) return { ready: false, detail: `no Deployment for ${t.name} in ${t.namespace} yet` };
  return rollouts(t, deployments, deadline, config.readyTimeoutSeconds, run, now);
}

interface Ingress {
  metadata: { name: string };
  spec: { rules?: Array<{ host?: string }>; tls?: Array<{ hosts?: string[] }> };
}

function urlOf(ingress: Ingress): string {
  const host = ingress.spec.rules?.find((r) => r.host !== undefined)?.host;
  if (host === undefined) throw new Error(`Ingress ${ingress.metadata.name} has no host`);
  const tls = ingress.spec.tls?.some((t) => t.hosts?.includes(host)) === true;
  return `${tls ? 'https' : 'http'}://${host}/`;
}

function previewUrl(config: KubernetesConfig, branch: string, run: Runner): string {
  const t = targetOf(config, branch);
  const args = ['get', 'ingress', '-n', t.namespace, ...t.selector, '-o', 'json'];
  const all = (JSON.parse(output(run('kubectl', args), 'kubectl', args)) as { items: Ingress[] }).items;
  const items = all.filter((i) => config.ingress === undefined || i.metadata.name === config.ingress);
  if (items.length === 1) return urlOf(items[0]!);
  const which = config.ingress === undefined ? `${items.length} Ingresses; name one with "ingress"` : `no Ingress named ${config.ingress}`;
  throw new Error(`no preview address for ${t.name} in ${t.namespace}: ${which}`);
}

type Prometheus = Extract<MetricsConfig, { source: 'prometheus' }>;
type Vector = { status: string; error?: string; data?: { result: Array<{ value: [number, string] }> } };

/** One instant query, its series summed; an empty result is 0. */
function query(m: Prometheus, promql: string, at: number, run: Runner): number {
  const path = `/api/v1/namespaces/${m.namespace}/services/${m.service}:${m.port}/proxy/api/v1/query?query=${encodeURIComponent(promql)}&time=${at}`;
  const args = ['get', '--raw', path];
  const reply = JSON.parse(output(run('kubectl', args), 'kubectl', args)) as Vector;
  if (reply.status !== 'success') throw new Error(`Prometheus refused the query: ${reply.error ?? reply.status}`);
  const total = reply.data!.result.reduce((sum, s) => sum + Number(s.value[1]), 0);
  if (Number.isNaN(total)) throw new Error(`Prometheus returned a value that is not a number for ${promql}`);
  return total;
}

function needRelease(release: string): void {
  if (!RELEASE.test(release)) throw new Error(`a release is a Kubernetes name, not ${JSON.stringify(release)}`);
}

function errorRate(config: KubernetesConfig, release: string, window: Window, run: Runner): ErrorRate {
  needRelease(release);
  const m = config.metrics;
  if (m.source === 'none') throw new Error('no metrics source configured ("preview" "metrics"), so the error rate cannot be read');
  const seconds = Math.round((window.end - window.start) / 1000);
  if (seconds <= 0) throw new Error('the window is empty');
  const fill = (template: string) => template.replaceAll('{namespace}', config.productionNamespace).replaceAll('{release}', release).replaceAll('{range}', `${seconds}s`);
  const at = window.end / 1000;
  return { errors: query(m, fill(m.errors), at, run), requests: query(m, fill(m.requests), at, run) };
}

function rollback(config: KubernetesConfig, release: string, run: Runner) {
  needRelease(release);
  const [tool, args]: [Tool, string[]] =
    config.mode === 'helm' ? ['helm', ['rollback', release, '-n', config.productionNamespace]] : ['kubectl', ['rollout', 'undo', `deployment/${release}`, '-n', config.productionNamespace]];
  return { release, detail: output(run(tool, args), tool, args).trim() };
}

type Namespace = { metadata: { annotations?: Record<string, string> } };

function cleanupNamespace(t: Target, branch: string, run: Runner): string[] {
  const get = ['get', 'namespace', t.name, '-o', 'json', '--ignore-not-found'];
  const found = output(run('kubectl', get), 'kubectl', get);
  if (found.trim() === '') return [];
  const owner = (JSON.parse(found) as Namespace).metadata.annotations?.[BRANCH_ANNOTATION];
  if (owner !== branch) throw new Error(`namespace ${t.name} is annotated ${BRANCH_ANNOTATION}=${JSON.stringify(owner)}, not ${JSON.stringify(branch)}; left as it is`);
  const del = ['delete', 'namespace', t.name, '--wait=false'];
  output(run('kubectl', del), 'kubectl', del);
  return [`namespace/${t.name}`];
}

function cleanupRelease(t: Target, run: Runner): string[] {
  const list = ['list', '-n', t.namespace, '--all', '--filter', `^${t.name}$`, '-o', 'json'];
  const releases = JSON.parse(output(run('helm', list), 'helm', list)) as Array<{ name: string; namespace: string }>;
  if (!releases.some((r) => r.name === t.name && r.namespace === t.namespace)) return [];
  const uninstall = ['uninstall', t.name, '-n', t.namespace];
  output(run('helm', uninstall), 'helm', uninstall);
  return [`release/${t.name}`];
}

function cleanup(config: KubernetesConfig, branch: string, run: Runner) {
  if (config.protectedBranches.includes(branch)) throw new Error(`${branch} is a protected branch; its environment is never cleaned up`);
  const t = targetOf(config, branch);
  return { removed: config.mode === 'namespace' ? cleanupNamespace(t, branch, run) : cleanupRelease(t, run) };
}

export function kubernetesEnvironment(config: KubernetesConfig, run: Runner, now: () => number): EnvironmentAdapter {
  return {
    platform: 'kubernetes',
    previewUrl: (branch) => previewUrl(config, branch, run),
    ready: (branch) => ready(config, branch, run, now),
    errorRate: (release, window) => errorRate(config, release, window, run),
    rollback: (release) => rollback(config, release, run),
    cleanup: (branch) => cleanup(config, branch, run),
  };
}
