import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../host/process-result.ts';
import { kubernetesConfigOf, type KubernetesConfig } from './config.ts';
import { previewWhenReady } from './environment.ts';
import { BRANCH_ANNOTATION, kubernetesEnvironment, type Runner, type Tool } from './kubernetes.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'kubernetes');
const recorded = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const ok = (name: string): ProcessResult => ({ status: 0, stdout: recorded(name), stderr: '' });
const failed = (name: string, stdout = ''): ProcessResult => ({ status: 1, stdout, stderr: recorded(name) });

const BRANCH = 'ticket/55-kubernetes-previews';
const NS = 'preview-ticket-55-kubernetes-previews-cb6145';
const PROMETHEUS = { source: 'prometheus', namespace: 'monitoring', service: 'prometheus-operated', errors: 'sum(increase(e{ns="{namespace}",app="{release}"}[{range}]))', requests: 'sum(increase(r[{range}]))' };

const config = (more: Record<string, unknown> = {}): KubernetesConfig => kubernetesConfigOf({ platform: 'kubernetes', productionNamespace: 'shop', readyTimeoutSeconds: 60, ...more });
const helm = (more: Record<string, unknown> = {}) => config({ mode: 'helm', namespace: 'previews', ...more });

/** A runner that plays back answers in order, keyed by the tool and its first two arguments, and records each call. */
function runner(answers: Record<string, ProcessResult[]>, onCall: () => void = () => {}) {
  const calls: Array<[Tool, string[]]> = [];
  const run: Runner = (tool, args) => {
    calls.push([tool, args]);
    onCall();
    const queue = answers[`${tool} ${args[0]} ${args[1]}`];
    return queue?.shift() ?? { status: 1, stdout: '', stderr: `no recorded answer for ${tool} ${args.join(' ')}` };
  };
  return { calls, run };
}

describe('ready and the preview URL', () => {
  it('a ready rollout gives the preview URL, from the Ingress host, https when the host has TLS', () => {
    const { run, calls } = runner({
      'kubectl get deployments': [ok('deployments.txt')],
      'kubectl rollout status': [ok('rollout-ready.txt'), ok('rollout-ready.txt')],
      'kubectl get ingress': [ok('ingress-list.json')],
    });
    const env = kubernetesEnvironment(config(), run, () => 0);
    expect(previewWhenReady(env, BRANCH)).toEqual({ ready: true, url: 'https://ticket-55.preview.example.com/', detail: `deployment.apps/web, deployment.apps/worker rolled out in ${NS}` });
    expect(calls).toEqual([
      ['kubectl', ['get', 'deployments', '-n', NS, '-o', 'name']],
      ['kubectl', ['rollout', 'status', 'deployment.apps/web', '-n', NS, '--timeout=60s']],
      ['kubectl', ['rollout', 'status', 'deployment.apps/worker', '-n', NS, '--timeout=60s']],
      ['kubectl', ['get', 'ingress', '-n', NS, '-o', 'json']],
    ]);
  });

  it('a stuck rollout reports not ready, with what kubectl said, and gives no URL', () => {
    const { run, calls } = runner({
      'kubectl get deployments': [ok('deployments.txt')],
      'kubectl rollout status': [failed('rollout-stuck.stderr.txt', recorded('rollout-waiting.txt'))],
    });
    const env = kubernetesEnvironment(config(), run, () => 0);
    expect(previewWhenReady(env, BRANCH)).toEqual({ ready: false, detail: 'deployment.apps/web not rolled out: error: deployment "web" exceeded its progress deadline' });
    expect(calls).toHaveLength(2);
  });

  it('a rollout still waiting at the timeout reports not ready: kubectl is given only the time left', () => {
    let clock = 0;
    const { run, calls } = runner(
      { 'kubectl get deployments': [ok('deployments.txt')], 'kubectl rollout status': [ok('rollout-ready.txt'), failed('rollout-timeout.stderr.txt')] },
      () => (clock += 25_500),
    );
    const env = kubernetesEnvironment(config(), run, () => clock);
    expect(env.ready(BRANCH)).toEqual({ ready: false, detail: 'deployment.apps/worker not rolled out: error: timed out waiting for the condition' });
    expect(calls[1]![1]).toContain('--timeout=35s');
    expect(calls[2]![1]).toContain('--timeout=9s');
  });

  it('reports not ready, without asking kubectl again, once the timeout is spent', () => {
    let clock = 0;
    const { run, calls } = runner({ 'kubectl get deployments': [ok('deployments.txt')], 'kubectl rollout status': [ok('rollout-ready.txt')] }, () => (clock += 30_000));
    const env = kubernetesEnvironment(config(), run, () => clock);
    expect(env.ready(BRANCH)).toEqual({ ready: false, detail: 'timed out after 60s, before deployment.apps/worker rolled out' });
    expect(calls).toHaveLength(2);
  });

  it('gives kubectl a whole second when less than one is left', () => {
    let clock = 0;
    const { run, calls } = runner({ 'kubectl get deployments': [ok('deployments.txt')], 'kubectl rollout status': [ok('rollout-ready.txt'), ok('rollout-ready.txt')] }, () => (clock += 29_999.5));
    expect(kubernetesEnvironment(config(), run, () => clock).ready(BRANCH).ready).toBe(true);
    expect(calls[2]![1]).toContain('--timeout=1s');
  });

  it('is not ready while nothing is deployed for the branch yet', () => {
    const { run } = runner({ 'kubectl get deployments': [{ status: 0, stdout: '\n', stderr: recorded('no-resources.stderr.txt') }] });
    expect(kubernetesEnvironment(config(), run, () => 0).ready(BRANCH)).toEqual({ ready: false, detail: `no Deployment for ${NS} in ${NS} yet` });
  });

  it('names the exit code or spawn error when a rollout fails without a word', () => {
    const one = (r: ProcessResult) => runner({ 'kubectl get deployments': [{ status: 0, stdout: 'deployment.apps/web', stderr: '' }], 'kubectl rollout status': [r] }).run;
    expect(kubernetesEnvironment(config(), one({ status: 3, stdout: '', stderr: '' }), () => 0).ready(BRANCH).detail).toBe('deployment.apps/web not rolled out: exit 3');
    expect(kubernetesEnvironment(config(), one({ status: null, stdout: '', stderr: '', error: new Error('spawn kubectl ENOENT') }), () => 0).ready(BRANCH).detail).toBe(
      'deployment.apps/web not rolled out: spawn kubectl ENOENT',
    );
  });

  it('throws when kubectl cannot list the deployments: an unread cluster is never "ready"', () => {
    const { run } = runner({ 'kubectl get deployments': [{ status: 1, stdout: '', stderr: 'error: You must be logged in to the server (Unauthorized)\n' }] });
    expect(() => kubernetesEnvironment(config(), run, () => 0).ready(BRANCH)).toThrow('kubectl get deployments failed: error: You must be logged in to the server (Unauthorized)');
  });

  it('in helm mode looks in the shared namespace, at the objects labelled with the branch release', () => {
    const { run, calls } = runner({ 'kubectl get deployments': [{ status: 0, stdout: '', stderr: '' }], 'kubectl get ingress': [ok('ingress-list.json')] });
    const env = kubernetesEnvironment(helm({ instanceLabel: 'release' }), run, () => 0);
    expect(env.ready(BRANCH).ready).toBe(false);
    expect(env.previewUrl(BRANCH)).toBe('https://ticket-55.preview.example.com/');
    expect(calls).toEqual([
      ['kubectl', ['get', 'deployments', '-n', 'previews', '-l', `release=${NS}`, '-o', 'name']],
      ['kubectl', ['get', 'ingress', '-n', 'previews', '-l', `release=${NS}`, '-o', 'json']],
    ]);
  });

  it('picks the Ingress the config names, its first rule with a host, http when that host has no TLS', () => {
    const { run } = runner({ 'kubectl get ingress': [ok('ingress-two.json')] });
    expect(kubernetesEnvironment(config({ ingress: 'web' }), run, () => 0).previewUrl(BRANCH)).toBe('http://ticket-55.preview.example.com/');
  });

  it('refuses to guess between two Ingresses, and says when the named one or any is missing', () => {
    const url = (c: KubernetesConfig, fixture: string) => kubernetesEnvironment(c, runner({ 'kubectl get ingress': [ok(fixture)] }).run, () => 0).previewUrl(BRANCH);
    expect(() => url(config(), 'ingress-two.json')).toThrow(`no preview address for ${NS} in ${NS}: 2 Ingresses; name one with "ingress"`);
    expect(() => url(config({ ingress: 'site' }), 'ingress-two.json')).toThrow(`no preview address for ${NS} in ${NS}: no Ingress named site`);
    expect(() => url(config(), 'ingress-none.json')).toThrow('0 Ingresses');
  });

  it('throws when the Ingress has no host, or has no rules at all', () => {
    const one = (spec: object) => ({ status: 0, stdout: JSON.stringify({ items: [{ metadata: { name: 'web' }, spec }] }), stderr: '' });
    const url = (spec: object) => kubernetesEnvironment(config(), runner({ 'kubectl get ingress': [one(spec)] }).run, () => 0).previewUrl(BRANCH);
    expect(() => url({ rules: [{}] })).toThrow('Ingress web has no host');
    expect(() => url({})).toThrow('Ingress web has no host');
    expect(url({ rules: [{ host: 'a.example.com' }], tls: [{}] })).toBe('http://a.example.com/');
    expect(url({ rules: [{ host: 'a.example.com' }] })).toBe('http://a.example.com/');
    expect(url({ rules: [{ host: 'a.example.com' }], tls: [{ hosts: ['b.example.com'] }, { hosts: ['a.example.com'] }] })).toBe('https://a.example.com/');
  });

  it('reads the deployment names from Windows line endings too', () => {
    const { run, calls } = runner({ 'kubectl get deployments': [{ status: 0, stdout: 'deployment.apps/web\r\n', stderr: '' }], 'kubectl rollout status': [ok('rollout-ready.txt')] });
    expect(kubernetesEnvironment(config(), run, () => 0).ready(BRANCH).ready).toBe(true);
    expect(calls[1]![1][2]).toBe('deployment.apps/web');
  });

  it('is the kubernetes platform', () => {
    expect(kubernetesEnvironment(config(), runner({}).run, () => 0).platform).toBe('kubernetes');
  });
});

describe('errorRate', () => {
  const WINDOW = { start: 1_791_273_000_000, end: 1_791_273_600_000 };

  it('sums each Prometheus query through the API server proxy, with the namespace, release and range filled in', () => {
    const { run, calls } = runner({ 'kubectl get --raw': [ok('prometheus-errors.json'), ok('prometheus-requests.json')] });
    expect(kubernetesEnvironment(config({ metrics: PROMETHEUS }), run, () => 0).errorRate('web', WINDOW)).toEqual({ errors: 42.5, requests: 400 });
    const proxy = '/api/v1/namespaces/monitoring/services/prometheus-operated:9090/proxy/api/v1/query?query=';
    expect(calls).toEqual([
      ['kubectl', ['get', '--raw', `${proxy}${encodeURIComponent('sum(increase(e{ns="shop",app="web"}[600s]))')}&time=1791273600`]],
      ['kubectl', ['get', '--raw', `${proxy}${encodeURIComponent('sum(increase(r[600s]))')}&time=1791273600`]],
    ]);
  });

  it('fills every placeholder in a query, not only the first', () => {
    const { run, calls } = runner({ 'kubectl get --raw': [ok('prometheus-empty.json'), ok('prometheus-empty.json')] });
    const metrics = { ...PROMETHEUS, errors: '{namespace}{namespace}{release}{release}{range}{range}' };
    expect(kubernetesEnvironment(config({ metrics }), run, () => 0).errorRate('web', WINDOW)).toEqual({ errors: 0, requests: 0 });
    expect(calls[0]![1][2]).toContain(encodeURIComponent('shopshopwebweb600s600s'));
  });

  it('throws when no metrics source is configured, so the incident rule alerts instead of judging', () => {
    expect(() => kubernetesEnvironment(config(), runner({}).run, () => 0).errorRate('web', WINDOW)).toThrow('no metrics source configured ("preview" "metrics"), so the error rate cannot be read');
  });

  it('throws on a query Prometheus refuses, a value that is not a number, or a failed kubectl', () => {
    const rate = (r: ProcessResult) => kubernetesEnvironment(config({ metrics: PROMETHEUS }), runner({ 'kubectl get --raw': [r] }).run, () => 0).errorRate('web', WINDOW);
    expect(() => rate(ok('prometheus-bad-query.json'))).toThrow('Prometheus refused the query: invalid parameter "query"');
    expect(() => rate({ status: 0, stdout: '{"status":"error"}', stderr: '' })).toThrow('Prometheus refused the query: error');
    expect(() => rate(ok('prometheus-nan.json'))).toThrow('Prometheus returned a value that is not a number for sum(increase(e{ns="shop",app="web"}[600s]))');
    expect(() => rate({ status: 1, stdout: '', stderr: 'Error from server (ServiceUnavailable): the server is currently unable to handle the request\n' })).toThrow(
      'kubectl get --raw failed: Error from server (ServiceUnavailable)',
    );
  });

  it('refuses an empty window and a release that is not a Kubernetes name', () => {
    const env = kubernetesEnvironment(config({ metrics: PROMETHEUS }), runner({}).run, () => 0);
    expect(() => env.errorRate('web', { start: 5000, end: 5400 })).toThrow('the window is empty');
    expect(() => env.errorRate('--all', WINDOW)).toThrow('a release is a Kubernetes name, not "--all"');
  });
});

describe('rollback', () => {
  it('undoes the production Deployment rollout with kubectl', () => {
    const { run, calls } = runner({ 'kubectl rollout undo': [ok('rollout-undo.txt')] });
    expect(kubernetesEnvironment(config(), run, () => 0).rollback('web')).toEqual({ release: 'web', detail: 'deployment.apps/web rolled back' });
    expect(calls).toEqual([['kubectl', ['rollout', 'undo', 'deployment/web', '-n', 'shop']]]);
  });

  it('in helm mode rolls the production release back to its previous revision', () => {
    const { run, calls } = runner({ 'helm rollback web': [ok('helm-rollback.txt')] });
    expect(kubernetesEnvironment(helm(), run, () => 0).rollback('web').detail).toBe('Rollback was a success! Happy Helming!');
    expect(calls).toEqual([['helm', ['rollback', 'web', '-n', 'shop']]]);
  });

  it('throws with what the tool said when the rollback fails, and refuses a name that is not one', () => {
    const { run } = runner({ 'kubectl rollout undo': [{ status: 1, stdout: '', stderr: 'error: no rollout history found for deployment "web"\n' }] });
    expect(() => kubernetesEnvironment(config(), run, () => 0).rollback('web')).toThrow('kubectl rollout undo failed: error: no rollout history found for deployment "web"');
    expect(() => kubernetesEnvironment(config(), run, () => 0).rollback('Web')).toThrow('a release is a Kubernetes name');
    expect(() => kubernetesEnvironment(config(), run, () => 0).rollback(`a${'b'.repeat(53)}`)).toThrow('a release is a Kubernetes name');
    expect(() => kubernetesEnvironment(config(), run, () => 0).rollback('web-')).toThrow('a release is a Kubernetes name');
  });

  it.each(['a', 'web-1', `a${'b'.repeat(51)}c`])('accepts the release name %s', (release) => {
    const { run, calls } = runner({ 'kubectl rollout undo': [ok('rollout-undo.txt')] });
    kubernetesEnvironment(config(), run, () => 0).rollback(release);
    expect(calls[0]![1][2]).toBe(`deployment/${release}`);
  });
});

describe('cleanup', () => {
  it('deletes the branch own namespace once its annotation names the exact branch', () => {
    const { run, calls } = runner({ 'kubectl get namespace': [ok('namespace-own.json')], 'kubectl delete namespace': [ok('namespace-delete.txt')] });
    expect(kubernetesEnvironment(config(), run, () => 0).cleanup(BRANCH)).toEqual({ removed: [`namespace/${NS}`] });
    expect(calls).toEqual([
      ['kubectl', ['get', 'namespace', NS, '-o', 'json', '--ignore-not-found']],
      ['kubectl', ['delete', 'namespace', NS, '--wait=false']],
    ]);
  });

  it('leaves a namespace that does not carry the branch annotation, and says whose it is', () => {
    const { run, calls } = runner({ 'kubectl get namespace': [ok('namespace-other.json')] });
    expect(() => kubernetesEnvironment(config(), run, () => 0).cleanup(BRANCH)).toThrow(`namespace ${NS} is annotated ${BRANCH_ANNOTATION}=undefined, not "${BRANCH}"; left as it is`);
    expect(calls).toHaveLength(1);
  });

  it('leaves a namespace annotated for another branch', () => {
    const other = JSON.parse(recorded('namespace-own.json'));
    other.metadata.annotations[BRANCH_ANNOTATION] = 'ticket-55-kubernetes-previews';
    const { run, calls } = runner({ 'kubectl get namespace': [{ status: 0, stdout: JSON.stringify(other), stderr: '' }] });
    expect(() => kubernetesEnvironment(config(), run, () => 0).cleanup(BRANCH)).toThrow('"ticket-55-kubernetes-previews", not');
    expect(calls).toHaveLength(1);
  });

  it('removes nothing when the namespace is already gone', () => {
    const { run, calls } = runner({ 'kubectl get namespace': [{ status: 0, stdout: '\n', stderr: '' }] });
    expect(kubernetesEnvironment(config(), run, () => 0).cleanup(BRANCH)).toEqual({ removed: [] });
    expect(calls).toHaveLength(1);
  });

  it('in helm mode uninstalls only the branch release, found by its exact name in the shared namespace', () => {
    const { run, calls } = runner({ 'helm list -n': [ok('helm-list.json')], 'helm uninstall preview-ticket-55-kubernetes-previews-cb6145': [ok('helm-uninstall.txt')] });
    expect(kubernetesEnvironment(helm(), run, () => 0).cleanup(BRANCH)).toEqual({ removed: [`release/${NS}`] });
    expect(calls).toEqual([
      ['helm', ['list', '-n', 'previews', '--all', '--filter', `^${NS}$`, '-o', 'json']],
      ['helm', ['uninstall', NS, '-n', 'previews']],
    ]);
  });

  it('in helm mode uninstalls nothing when the list holds no release of that exact name and namespace', () => {
    const elsewhere = JSON.stringify([{ name: NS, namespace: 'other' }, { name: `${NS}-x`, namespace: 'previews' }]);
    for (const listed of [recorded('helm-list-none.json'), elsewhere]) {
      const { run, calls } = runner({ 'helm list -n': [{ status: 0, stdout: listed, stderr: '' }] });
      expect(kubernetesEnvironment(helm(), run, () => 0).cleanup(BRANCH)).toEqual({ removed: [] });
      expect(calls).toHaveLength(1);
    }
  });

  it('never cleans up a protected branch', () => {
    const { run, calls } = runner({});
    expect(() => kubernetesEnvironment(config(), run, () => 0).cleanup('main')).toThrow('main is a protected branch; its environment is never cleaned up');
    expect(() => kubernetesEnvironment(helm({ protectedBranches: ['release/1'] }), run, () => 0).cleanup('release/1')).toThrow('release/1 is a protected branch');
    expect(calls).toEqual([]);
  });

  it('throws, naming the tool, when kubectl cannot read the namespace or Helm cannot uninstall', () => {
    const forbidden = { status: 1, stdout: '', stderr: 'Forbidden\n' };
    expect(() => kubernetesEnvironment(config(), runner({ 'kubectl get namespace': [forbidden] }).run, () => 0).cleanup(BRANCH)).toThrow('kubectl get namespace failed: Forbidden');
    const { run } = runner({ 'helm list -n': [ok('helm-list.json')], [`helm uninstall ${NS}`]: [forbidden] });
    expect(() => kubernetesEnvironment(helm(), run, () => 0).cleanup(BRANCH)).toThrow(`helm uninstall ${NS} failed: Forbidden`);
  });

  it('throws when the delete fails', () => {
    const { run } = runner({ 'kubectl get namespace': [ok('namespace-own.json')], 'kubectl delete namespace': [{ status: 1, stdout: '', stderr: 'Error from server (Forbidden): namespaces is forbidden\n' }] });
    expect(() => kubernetesEnvironment(config(), run, () => 0).cleanup(BRANCH)).toThrow('kubectl delete namespace failed: Error from server (Forbidden)');
  });
});
