// Which host a project's CI and PR gates talk to (ticket 54): projects/<name>/project.json "pr"
// names it with "host" (github, the default, or azure-devops) and, for Azure DevOps, the
// "organization", "project" and "repository". The token is never in this file: the Azure DevOps
// adapter reads it from the environment.

import { azureDevOpsHost, type AzureDevOpsConfig } from './azure-devops.ts';
import { githubHost, type Gh } from './github.ts';
import type { HostAdapter } from './host.ts';
import type { HttpClient } from './http.ts';

export type HostConfig = { host: 'github' } | ({ host: 'azure-devops' } & AzureDevOpsConfig);

/** What the adapters run on: gh for GitHub, the HTTP client and the environment for Azure DevOps. */
export interface HostDeps {
  gh: Gh;
  http: HttpClient;
  env: Record<string, string | undefined>;
}

const AZURE_FIELDS = ['organization', 'project', 'repository'] as const;

function azureOf(pr: Record<string, unknown>): HostConfig {
  const missing = AZURE_FIELDS.find((f) => typeof pr[f] !== 'string' || pr[f] === '');
  if (missing) throw new Error(`"pr" with host azure-devops needs "${missing}" (a name)`);
  return { host: 'azure-devops', organization: pr.organization as string, project: pr.project as string, repository: pr.repository as string };
}

/** The host a project's "pr" config names; GitHub when it names none. Throws on a broken one. */
export function hostConfigOf(pr: unknown): HostConfig {
  const config = Object(pr) as Record<string, unknown>;
  if (config.host === undefined || config.host === 'github') return { host: 'github' };
  if (config.host === 'azure-devops') return azureOf(config);
  throw new Error(`"pr" "host" is github or azure-devops, not ${JSON.stringify(config.host)}`);
}

/** The adapter; throws when it cannot be made (Azure DevOps without its PAT). */
export function hostAdapterOf(config: HostConfig, deps: HostDeps): HostAdapter {
  return config.host === 'github' ? githubHost(deps.gh) : azureDevOpsHost(config, deps.http, deps.env);
}

/**
 * The adapter, or when it cannot be made one whose every call throws why. A controller wires the
 * host before it knows a call is needed, so the missing PAT fails the call that needed it (exit 2,
 * a ship error), never the wiring.
 */
export function hostAdapterOrFailure(config: HostConfig, deps: HostDeps): HostAdapter {
  let made: HostAdapter;
  try {
    made = hostAdapterOf(config, deps);
  } catch (e) {
    const fail = (): never => {
      throw e;
    };
    return { host: config.host, checksForCommit: fail, openDraftPr: fail, prStatus: fail, workItem: fail, setWorkItemState: fail };
  }
  return made;
}
