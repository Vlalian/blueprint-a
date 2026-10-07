// The environment adapter (ticket 55): the five calls the preview, walk-the-app and incident steps
// make on wherever the work is deployed. Blueprint B answers them with a Vercel preview, a Neon
// branch and a Vercel rollback; kubernetes.ts answers them with kubectl (and optionally Helm)
// behind an injected runner. The steps read only this interface.

/** A span of time, in milliseconds since the epoch. */
export interface Window {
  start: number;
  end: number;
}

export interface Readiness {
  ready: boolean;
  /** What was seen: the rollouts that finished, or why the preview is not ready. */
  detail: string;
}

/** 5xx and all responses of a release in a window, as the cluster's metrics count them. */
export interface ErrorRate {
  errors: number;
  requests: number;
}

export interface Rollback {
  release: string;
  /** What the rollback command printed. */
  detail: string;
}

export interface Cleanup {
  /** What was removed (namespace/<name> or release/<name>); [] when nothing was there. */
  removed: string[];
}

export interface EnvironmentAdapter {
  platform: 'kubernetes';
  /** The branch's preview address, from its Ingress; throws when there is none. */
  previewUrl(branch: string): string;
  /** Whether every rollout of the branch's preview finished within the configured timeout. */
  ready(branch: string): Readiness;
  /** A production release's 5xx and requests in the window; throws when the metrics cannot be read. */
  errorRate(release: string, window: Window): ErrorRate;
  /** Rolls the production release back to its previous revision. Only the incident rule calls it. */
  rollback(release: string): Rollback;
  /** Removes the branch's own preview and nothing else. */
  cleanup(branch: string): Cleanup;
}

export type Preview = { ready: true; url: string; detail: string } | { ready: false; detail: string };

/** The preview's address once it is ready; never an address for a preview that is not. */
export function previewWhenReady(env: EnvironmentAdapter, branch: string): Preview {
  const r = env.ready(branch);
  return r.ready ? { ready: true, url: env.previewUrl(branch), detail: r.detail } : { ready: false, detail: r.detail };
}
