import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostDeps } from '../adapters/host/config.ts';
import type { HttpReply, HttpRequest } from '../adapters/host/http.ts';
import { fakeCli, memFs, memLock, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import { runFlow, TOOLS, USAGE, type FlowIo } from './main.ts';
import { upTo } from './state.ts';

// The recorded replies, found the same way in this repo and in the exported package.
const FIXTURES = upTo(import.meta.dirname, join('fixtures', 'azure-devops'), existsSync);
const SHA = '4c1e2f0a9b8d7c6e5f4a3b2c1d0e9f8a7b6c5d4e';
const API = 'https://dev.azure.com/fabrikam/Fabrikam-Fiber/_apis/';
const AZURE = { host: 'azure-devops', organization: 'fabrikam', project: 'Fabrikam-Fiber', repository: 'fabrikam-web' };

type Route = [method: string, path: string, file: string, status?: number];

/** An HTTP client answering from the recorded Azure DevOps replies by method and path. */
function replay(routes: Route[]) {
  const asked: HttpRequest[] = [];
  const http = (req: HttpRequest): HttpReply => {
    asked.push(req);
    const path = req.url.split('?')[0]!.slice(API.length);
    const route = routes.find(([m, p]) => m === req.method && p === path);
    if (route === undefined) throw new Error(`no recorded reply for ${req.method} ${path}`);
    return { status: route[3] ?? 200, body: readFileSync(join(FIXTURES, route[2]), 'utf8') };
  };
  return { asked, http };
}

function world(o: { config?: object | string; routes?: Route[]; git?: Parameters<typeof fakeCli>[0]; root?: string } = {}) {
  const root = o.root ?? ROOT;
  const config = o.config === undefined ? {} : { [join(root, 'config', 'flow.json')]: typeof o.config === 'string' ? o.config : JSON.stringify(o.config) };
  const fs = memFs(config);
  const git = fakeCli(o.git);
  const gh = fakeCli();
  const azure = replay(o.routes ?? []);
  const thrown: string[][] = [];
  const said: string[] = [];
  const logged: string[] = [];
  const lock = memLock();
  const locked: string[] = [];
  const deps: HostDeps = { gh: gh.run.bind(null, ROOT), http: azure.http, env: { AZURE_DEVOPS_PAT: 'pat' } };
  const io: FlowIo = {
    root,
    ...fs,
    git: git.run,
    platform: 'linux',
    shell: () => ({ status: 0, stdout: '', stderr: '' }),
    run: () => 0,
    logged: () => 0,
    lock: (path) => (locked.push(path), lock),
    ticketFiles: () => [],
    id: () => 'id',
    worktreeId: () => 'id',
    clock: () => 0,
    now: () => '2026-10-21T10:00:00.123Z',
    out: (t) => void said.push(t),
    hostDeps: () => deps,
    gitIn: (cwd) => (args) => (thrown.push([cwd, ...args]), args[0] === 'rev-parse' ? `${SHA}\n` : ''),
    epochMs: () => 0,
    sleep: () => undefined,
    log: (line) => void logged.push(line),
  };
  return { io, fs, git, gh, azure, thrown, said: () => said.join(''), logged, locked, lock };
}

describe('flow <tool>', () => {
  it('names every tool in its usage, and prints it for an unknown or missing tool', () => {
    expect(Object.keys(TOOLS)).toEqual(['status', 'done', 'in-flight', 'gate-queue', 'build', 'review', 'merge', 'apply-lessons', 'pr', 'watch-pr', 'ledger']);
    expect(USAGE).toBe('usage: flow <status|done|in-flight|gate-queue|build|review|merge|apply-lessons|pr|watch-pr|ledger> [args]\n');
    for (const argv of [[], ['nope'], ['toString']]) {
      const w = world();
      expect(runFlow(argv, w.io)).toBe(2);
      expect(w.said()).toBe(USAGE);
    }
  });

  it('exits 2 naming a broken config/flow.json, before any tool runs', () => {
    const w = world({ config: { buildCap: 0 } });
    expect(runFlow(['status'], w.io)).toBe(2);
    expect(w.said()).toBe('config/flow.json: buildCap is not a whole number above 0\n');
    expect(w.git.calls).toEqual([]);
  });

  it('runs a tool with the repo config: flow status warns above the configured cap', () => {
    const w = world({ config: { buildCap: 1 }, git: { 'for-each-ref': ok('origin/ticket/1-a\norigin/ticket/2-b\n'), 'merge-base --is-ancestor': { status: 1, stdout: '', stderr: '' } } });
    expect(runFlow(['status'], w.io)).toBe(0);
    expect(w.said()).toContain('\nWarning: 2 builds in flight (unrecorded 2): more than the cap of 1, every family counted together\n');
  });

  it('runs the gate queue under the gate lock and merge in the integration worktree', () => {
    const w = world({ config: { worktreeDir: 'wt' } });
    expect(runFlow(['gate-queue', 'list'], w.io)).toBe(0);
    expect(runFlow(['done'], w.io)).toBe(0);
    expect(runFlow(['in-flight', 'end', 'ticket/1-a'], w.io)).toBe(0);
    expect(runFlow(['merge', '--consent', '1', 'yes'], w.io)).toBe(1);
    expect(runFlow(['build', '1'], w.io)).toBe(1);
    expect(runFlow(['review', '1'], w.io)).toBe(1);
    expect(runFlow(['apply-lessons'], w.io)).toBe(0);
    expect(w.said()).toContain('Refused: ticket 1 has no result in the gate queue');
  });
});

describe('the gate lock', () => {
  // git prints the main worktree's common directory relative to it and a linked worktree's as an absolute path.
  const REPO = resolve(ROOT);
  const LOCK = join(REPO, '.git', 'state', 'flow', 'gate.lock');

  it("is one file in git's common directory, so two worktrees of the repo never run two gates at once", () => {
    const main = world({ root: REPO, git: { 'rev-parse --git-common-dir': ok('.git\n') } });
    const linked = world({ root: join(REPO, 'wt', 'b'), git: { 'rev-parse --git-common-dir': ok(`${join(REPO, '.git')}\n`) } });
    expect(runFlow(['gate-queue', 'run'], main.io)).toBe(0);
    expect(runFlow(['gate-queue', 'run'], linked.io)).toBe(0);
    expect(main.locked).toEqual([LOCK]);
    expect(linked.locked).toEqual([LOCK]);
    expect(main.lock.held()).toBeUndefined();
  });

  it('refuses to run a gate when git cannot name its common directory', () => {
    const w = world({ git: { 'rev-parse --git-common-dir': { status: 128, stdout: '', stderr: 'not a git repository' } } });
    expect(() => runFlow(['gate-queue', 'run'], w.io)).toThrow('git cannot name its common directory');
    expect(w.locked).toEqual([]);
  });
});

describe('Pass when: on Azure DevOps the PR and CI tools read the pipeline result through adapters/host', () => {
  const routes: Route[] = [
    ['GET', 'git/repositories/fabrikam-web/pullrequests/22', 'pr-active.json'],
    ['GET', 'policy/evaluations', 'policy-evaluations-running.json'],
    ['GET', 'build/builds', 'builds-succeeded.json'],
  ];

  it("watches CI on the PR's exact head with the pipeline runs Azure DevOps reports, never gh", () => {
    const w = world({ config: { host: AZURE }, routes });
    expect(runFlow(['watch-pr', '--pr', '22', '--timeout', '0'], w.io)).toBe(0);
    expect(JSON.parse(w.said())).toMatchObject({ pr: '22', sha: SHA, outcome: 'green', exitCode: 0, ci: { sha: SHA, state: 'green', passed: ['e2e', 'ci'] } });
    expect(w.azure.asked.map((r) => r.url.split('?')[0])).toContain(`${API}build/builds`);
    expect(w.gh.calls).toEqual([]);
  });

  it('reads a failed pipeline as failing CI', () => {
    const w = world({ config: { host: AZURE }, routes: [routes[0]!, routes[1]!, ['GET', 'build/builds', 'builds-failed.json']] });
    expect(runFlow(['watch-pr', '--pr', '22', '--sha', SHA, '--timeout', '0'], w.io)).toBe(4);
    expect(JSON.parse(w.said())).toMatchObject({ outcome: 'failing', ci: { failing: ['ci'] } });
  });

  it('opens the draft PR on Azure DevOps against the integration branch', () => {
    const w = world({ config: { host: AZURE, integrationBranch: 'develop' }, routes: [['GET', 'git/repositories/fabrikam-web/pullrequests', 'pr-list-none.json'], ['POST', 'git/repositories/fabrikam-web/pullrequests', 'pr-created.json', 201]] });
    expect(runFlow(['pr', '--branch', 'ticket/07', '--title', 'Ticket 7'], w.io)).toBe(0);
    expect(JSON.parse(w.said())).toMatchObject({ ok: true, branch: 'ticket/07', sha: SHA, created: true, draft: true });
    expect(JSON.parse(w.azure.asked[1]!.body!)).toMatchObject({ sourceRefName: 'refs/heads/ticket/07', targetRefName: 'refs/heads/develop', isDraft: true });
    expect(w.thrown).toEqual([
      ['.', 'rev-parse', '--verify', 'refs/heads/ticket/07^{commit}'],
      ['.', 'push', '-u', 'origin', 'refs/heads/ticket/07:refs/heads/ticket/07'],
    ]);
  });

  it('uses gh on GitHub, the default host', () => {
    const w = world();
    expect(runFlow(['watch-pr', '--pr', '22', '--timeout', '0'], w.io)).toBe(7);
    expect(w.gh.calls.length).toBeGreaterThan(0);
    expect(w.azure.asked).toEqual([]);
  });
});

describe('flow ledger', () => {
  it('records a verdict with the time to the second, and prints JSON', () => {
    const w = world();
    expect(runFlow(['ledger', 'record', '--ledger', 'l.tsv', '--sha', 'HEAD', '--base', 'main', '--verdict', 'VERIFIED', '--ticket', '7'], w.io)).toBe(0);
    expect(w.fs.read('l.tsv')).toBe(`${SHA}\t-\tVERIFIED\t7\t2026-10-21T10:00:00Z\n`);
    expect(JSON.parse(w.said()).recorded).toMatchObject({ sha: SHA, verdict: 'VERIFIED' });
    expect(runFlow(['ledger', 'check', '--ledger', 'l.tsv', '--sha', 'HEAD', '--base', 'main'], w.io)).toBe(0);
  });
});
