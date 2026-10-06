import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE, kubernetesConfigOf } from './config.ts';

const base = { platform: 'kubernetes', productionNamespace: 'shop' };
const prometheus = { source: 'prometheus', namespace: 'monitoring', service: 'prometheus-operated', errors: 'sum(e)', requests: 'sum(r)' };

describe('kubernetesConfigOf', () => {
  it('fills every default: namespace mode, rollback off with Blueprint B numbers, no metrics', () => {
    expect(kubernetesConfigOf(base)).toEqual({
      mode: 'namespace',
      prefix: 'preview-',
      namespace: '',
      instanceLabel: 'app.kubernetes.io/instance',
      ingress: undefined,
      readyTimeoutSeconds: 300,
      productionNamespace: 'shop',
      protectedBranches: ['main', 'master', 'dev', 'develop'],
      metrics: { source: 'none' },
      rollback: DEFAULT_RULE,
    });
    expect(DEFAULT_RULE).toEqual({
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
    });
  });

  it('reads helm mode with its shared namespace, and every setting given', () => {
    const c = kubernetesConfigOf({
      ...base,
      mode: 'helm',
      prefix: 'pr-',
      namespace: 'previews',
      instanceLabel: 'release',
      ingress: 'web',
      readyTimeoutSeconds: 120,
      protectedBranches: ['trunk'],
      metrics: { ...prometheus, port: 'web' },
      rollback: { enabled: true, windowMinutes: 15, cooldownHours: 48 },
    });
    expect(c).toMatchObject({ mode: 'helm', prefix: 'pr-', namespace: 'previews', instanceLabel: 'release', ingress: 'web', readyTimeoutSeconds: 120, protectedBranches: ['trunk'] });
    expect(c.metrics).toEqual({ ...prometheus, port: 'web' });
    expect(c.rollback).toEqual({ ...DEFAULT_RULE, enabled: true, windowMinutes: 15, cooldownHours: 48 });
  });

  it('gives Prometheus port 9090 by default', () => {
    expect(kubernetesConfigOf({ ...base, metrics: prometheus }).metrics).toEqual({ ...prometheus, port: '9090' });
  });

  it('keeps rollback off unless enabled is exactly true', () => {
    expect(kubernetesConfigOf({ ...base, rollback: {} }).rollback.enabled).toBe(false);
    expect(kubernetesConfigOf({ ...base, rollback: { enabled: false } }).rollback.enabled).toBe(false);
    expect(() => kubernetesConfigOf({ ...base, rollback: { enabled: 'yes' } })).toThrow('"preview": "enabled" must be true or false');
  });

  it('refuses a cooldown under a day: at most one automatic rollback a day', () => {
    expect(() => kubernetesConfigOf({ ...base, rollback: { cooldownHours: 23.5 } })).toThrow('"preview": "cooldownHours" is out of range: 23.5');
    expect(kubernetesConfigOf({ ...base, rollback: { cooldownHours: 24 } }).rollback.cooldownHours).toBe(24);
  });

  it.each([
    [{ min5xxRatio: 1 }, 'min5xxRatio'],
    [{ min5xxRatio: 0 }, 'min5xxRatio'],
    [{ min5xxCount: 0 }, 'min5xxCount'],
    [{ windowMinutes: '10' }, 'windowMinutes'],
  ])('refuses a rule number out of range: %j', (r, key) => {
    expect(() => kubernetesConfigOf({ ...base, rollback: r })).toThrow(`"${key}" is out of range`);
  });

  it('accepts a ratio just inside its bounds', () => {
    expect(kubernetesConfigOf({ ...base, rollback: { min5xxRatio: 0.99 } }).rollback.min5xxRatio).toBe(0.99);
  });

  it.each([
    [undefined, '"preview" must be an object'],
    [[], '"preview" must be an object'],
    [null, '"preview" must be an object'],
    [{ platform: 'vercel', productionNamespace: 'shop' }, '"platform" is kubernetes, not "vercel"'],
    [{ platform: 'kubernetes' }, '"productionNamespace" is required'],
    [{ ...base, extra: 1 }, '"preview" has an unknown key "extra"'],
    [{ ...base, mode: 'kustomize' }, '"mode" is namespace or helm, not "kustomize"'],
    [{ ...base, mode: 'helm' }, '"namespace" is required'],
    [{ ...base, prefix: 'Preview-' }, '"prefix" must match'],
    [{ ...base, prefix: 'a'.repeat(21) }, '"prefix" must match'],
    [{ ...base, productionNamespace: 'Shop' }, '"productionNamespace" must match'],
    [{ ...base, productionNamespace: 'shop-' }, '"productionNamespace" must match'],
    [{ ...base, productionNamespace: 7 }, '"productionNamespace" must match'],
    [{ ...base, ingress: 'a b' }, '"ingress" must match'],
    [{ ...base, instanceLabel: 'x y' }, '"instanceLabel" must match'],
    [{ ...base, readyTimeoutSeconds: 0 }, '"readyTimeoutSeconds" is out of range: 0'],
    [{ ...base, protectedBranches: 'main' }, '"protectedBranches" must be a list of branch names'],
    [{ ...base, protectedBranches: [1] }, '"protectedBranches" must be a list of branch names'],
    [{ ...base, protectedBranches: ['main', 1] }, '"protectedBranches" must be a list of branch names'],
    [{ ...base, metrics: 5 }, '"metrics" must be an object'],
    [{ ...base, rollback: [] }, '"rollback" must be an object'],
    [{ ...base, rollback: { auto: true } }, '"rollback" has an unknown key "auto"'],
    [{ ...base, metrics: { source: 'datadog' } }, '"metrics" "source" is none or prometheus, not "datadog"'],
    [{ ...base, metrics: { ...prometheus, extra: 1 } }, '"metrics" has an unknown key "extra"'],
    [{ ...base, metrics: { ...prometheus, errors: ' ' } }, '"errors" must match'],
    [{ ...base, metrics: { ...prometheus, requests: undefined } }, '"requests" is required'],
    [{ ...base, metrics: { ...prometheus, port: '90 90' } }, '"port" must match'],
    [{ ...base, metrics: { ...prometheus, service: 'Prom' } }, '"service" must match'],
    [{ ...base, metrics: { ...prometheus, namespace: '' } }, '"namespace" must match'],
  ])('refuses %j', (preview, message) => {
    expect(() => kubernetesConfigOf(preview)).toThrow(`"preview": ${message}`);
  });

  it('accepts names at the limits of a DNS label and a prefixed label key', () => {
    const c = kubernetesConfigOf({ ...base, productionNamespace: `a${'b'.repeat(61)}c`, prefix: `p${'q'.repeat(19)}`, instanceLabel: 'example.com/instance' });
    expect(c.productionNamespace).toHaveLength(63);
    expect(c.prefix).toHaveLength(20);
    expect(() => kubernetesConfigOf({ ...base, productionNamespace: `a${'b'.repeat(62)}c` })).toThrow('"productionNamespace" must match');
    expect(kubernetesConfigOf({ ...base, productionNamespace: 'a' }).productionNamespace).toBe('a');
  });
});
