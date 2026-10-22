// A fake `gh` for tests: a node script, run through process.execPath (never a .cmd shim), that
// answers the few gh calls the PR scripts make from a JSON state file, and logs every call. Pull
// requests live in the state file; a PR's head SHA is read live from a local bare remote, the way
// GitHub reads it from the pushed branch. CI per SHA is whatever the test puts in the state.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { templated } from './repo-template.ts';

export interface FakeCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface FakeStatus {
  context: string;
  state: string;
}

export interface FakeGhState {
  /** The bare remote the PR branches are pushed to. */
  remote: string;
  prs: Array<{ number: number; url: string; headRefName: string; baseRefName: string; isDraft: boolean; title: string; body: string; state: string }>;
  /** Check runs per SHA; '*' answers for any SHA without its own. */
  checks: Record<string, FakeCheckRun[]>;
  statuses: Record<string, FakeStatus[]>;
  /** gh exits 1 with this message on every call when set. */
  fail?: string;
}

const SCRIPT = String.raw`
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const [stateFile, logFile] = [process.env.FAKE_GH_STATE, process.env.FAKE_GH_LOG];
const args = process.argv.slice(2);
fs.appendFileSync(logFile, JSON.stringify(args) + '\n');
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const out = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const head = (pr) => execFileSync('git', ['--git-dir', state.remote, 'rev-parse', 'refs/heads/' + pr.headRefName], { encoding: 'utf8' }).trim();
const view = (pr) => ({ ...pr, headRefOid: head(pr) });
function main() {
  if (state.fail) { process.stderr.write(state.fail + '\n'); return 1; }
  const [group, verb] = args;
  if (group === 'pr' && verb === 'list') {
    out(state.prs.filter((p) => p.headRefName === flag('--head') && p.state === 'OPEN').map(view));
    return 0;
  }
  if (group === 'pr' && verb === 'create') {
    const number = state.prs.length + 1;
    const url = 'https://github.com/owner/repo/pull/' + number;
    state.prs.push({ number, url, headRefName: flag('--head'), baseRefName: flag('--base'), isDraft: args.includes('--draft'), title: flag('--title'), body: flag('--body'), state: 'OPEN' });
    save();
    process.stdout.write(url + '\n');
    return 0;
  }
  if (group === 'pr' && verb === 'view') {
    const pr = state.prs.find((p) => String(p.number) === args[2] || p.url === args[2] || p.headRefName === args[2]);
    if (!pr) { process.stderr.write('no pull requests found\n'); return 1; }
    out(view(pr));
    return 0;
  }
  const api = group === 'api' ? /commits\/([0-9a-f]+)\/(check-runs|status)$/.exec(args.find((a) => a.startsWith('repos/')) || '') : null;
  if (api && api[2] === 'check-runs') {
    const runs = state.checks[api[1]] || state.checks['*'] || [];
    out({ total_count: runs.length, check_runs: runs });
    return 0;
  }
  if (api) {
    out({ state: 'pending', total_count: (state.statuses[api[1]] || []).length, statuses: state.statuses[api[1]] || [] });
    return 0;
  }
  process.stderr.write('fake gh: not allowed or not faked: ' + args.join(' ') + '\n');
  return 1;
}
process.exitCode = main();
`;

export interface FakeGh {
  /** The script; run it as process.execPath <script>. */
  script: string;
  /** Environment the fake needs; merge into the env of whatever spawns it. */
  env: Record<string, string>;
  state(): FakeGhState;
  setState(edit: (s: FakeGhState) => void): void;
  /** Every call's arguments, in order. */
  calls(): string[][];
}

export function fakeGh(remote: string): FakeGh {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const script = join(dir, 'gh.js');
  const stateFile = join(dir, 'state.json');
  const logFile = join(dir, 'calls.log');
  writeFileSync(script, SCRIPT);
  writeFileSync(logFile, '');
  writeFileSync(stateFile, JSON.stringify({ remote, prs: [], checks: {}, statuses: {} } satisfies FakeGhState));
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8')) as FakeGhState;
  return {
    script,
    env: { FAKE_GH_STATE: stateFile, FAKE_GH_LOG: logFile },
    state,
    setState: (edit) => {
      const s = state();
      edit(s);
      writeFileSync(stateFile, JSON.stringify(s));
    },
    calls: () =>
      readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[]),
  };
}

/** main pushed to a bare remote, and a ticket branch with one commit on top, in `root`. */
function buildRepo(root: string, branch: string): void {
  const remote = join(root, 'remote.git');
  const dir = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('remote', 'add', 'origin', remote);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('push', '-q', 'origin', 'main');
  g('checkout', '-qb', branch);
  writeFileSync(join(dir, 'a.txt'), 'a\nticket\n');
  g('commit', '-qam', 'ticket');
  g('checkout', '-q', 'main');
}

const copies = new Map<string, () => string>();

/**
 * A bare remote, and a clone of it with main pushed and a ticket branch with one commit on top.
 * Built once per branch and test file, then copied (test/helpers/repo-template.ts): a fresh repo
 * costs one git call, not twelve.
 */
export function repoWithRemote(branch = 'ticket/01') {
  if (!copies.has(branch)) copies.set(branch, templated('pr-repo-', (root) => buildRepo(root, branch)));
  const root = copies.get(branch)!();
  const remote = join(root, 'remote.git');
  const dir = join(root, 'work');
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  g('remote', 'set-url', 'origin', remote);
  const remoteSha = (ref: string) => execFileSync('git', ['--git-dir', remote, 'rev-parse', '--verify', '-q', ref], { encoding: 'utf8' }).trim();
  return { root, remote, dir, g, remoteSha };
}
