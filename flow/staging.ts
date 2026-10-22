// One standing staging preview (phase 2 decision 22, ticket 22). A project names the long-lived
// branch merged work collects in ("integrationBranch", dev) and the branch it is promoted to
// ("promoteTo", main, production); draft PRs target the integration branch, and nothing ever
// merges into the promoted branch automatically: promoting is the owner's step. "stagingUrl" is
// the fixed URL Vercel serves the integration branch on. A project with neither has no staging.

export interface StagingConfig {
  integrationBranch?: unknown;
  promoteTo?: unknown;
  stagingUrl?: unknown;
}

export interface Staging {
  integrationBranch: string;
  promoteTo: string;
  url?: string;
}

const isName = (v: unknown): v is string => typeof v === 'string' && v !== '';

const CHECKS: [(c: StagingConfig) => boolean, (c: StagingConfig) => string][] = [
  [(c) => isName(c.integrationBranch) && isName(c.promoteTo), () => 'project.json needs both "integrationBranch" and "promoteTo" (branch names), or neither'],
  [(c) => c.integrationBranch !== c.promoteTo, (c) => `"integrationBranch" and "promoteTo" are both ${c.promoteTo}: work would land in production unreviewed`],
  [(c) => c.stagingUrl === undefined || isName(c.stagingUrl), () => '"stagingUrl" is not a URL'],
];

/** The project's staging, or undefined when it names none. Throws on a broken one. */
export function stagingOf(config: StagingConfig): Staging | undefined {
  if (config.integrationBranch === undefined && config.promoteTo === undefined) return undefined;
  const failed = CHECKS.find(([holds]) => !holds(config));
  if (failed) throw new Error(failed[1](config));
  return { integrationBranch: config.integrationBranch as string, promoteTo: config.promoteTo as string, url: config.stagingUrl as string | undefined };
}

/** The project's "pr" config with staging applied: draft PRs against the integration branch, never the promoted one. */
export function prConfigOf<P extends { base: string }>(config: StagingConfig & { pr?: P }): (P & { promoteTo?: string }) | undefined {
  if (!config.pr) return undefined;
  const staging = stagingOf(config);
  return staging ? { ...config.pr, base: staging.integrationBranch, promoteTo: staging.promoteTo } : config.pr;
}
