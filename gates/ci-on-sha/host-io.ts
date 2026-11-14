// The real I/O behind the CI gate's host (moved from scripts/ship-io.ts in ticket 95): the host
// adapter a project's "pr" config names, GitHub through gh by default. gh is GH_CLI if set (a .js
// entry runs under process.execPath, so tests use a fake gh), else the gh on PATH, never interactive.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostAdapterOrFailure, type HostConfig } from '../../adapters/host/config.ts';
import type { HostAdapter } from '../../adapters/host/host.ts';
import { childHttp, type HttpClient } from '../../adapters/host/http.ts';
import type { ProcessResult } from '../../adapters/host/process-result.ts';
import { claudeCommand } from '../lib/cli-command.ts';

const FETCH_ONCE = join(import.meta.dirname, '..', '..', 'adapters', 'host', 'fetch-once.ts');

/** HTTP for the Azure DevOps host: each request in a child node (adapters/host/http.ts), on stdin. */
const httpClient: HttpClient = childHttp((input) => spawnSync(process.execPath, [FETCH_ONCE], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

function ghRunner(cwd: string, cli = process.env.GH_CLI || 'gh'): (args: string[]) => ProcessResult {
  return (args) => {
    const [command, argv] = claudeCommand(cli, args, process.execPath);
    const env = { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' };
    return spawnSync(command, argv, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  };
}

/** The host adapter a project's "pr" config names, GitHub by default; without its PAT, every Azure DevOps call fails naming the variable. */
export function hostFor(cwd: string, config: HostConfig = { host: 'github' }): HostAdapter {
  return hostAdapterOrFailure(config, { gh: ghRunner(cwd), http: httpClient, env: process.env });
}

// WORKFLOW_PROJECTS_DIR reads the project configs from elsewhere.
const PROJECTS = process.env.WORKFLOW_PROJECTS_DIR ?? join(resolve(import.meta.dirname, '..', '..'), 'projects');

/** projects/<name>/project.json, parsed; throws when it cannot be read. */
export const readProjectJson = (name: string): object => JSON.parse(readFileSync(join(PROJECTS, name, 'project.json'), 'utf8')) as object;
