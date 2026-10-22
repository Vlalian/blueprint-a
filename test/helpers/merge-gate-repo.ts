// A real repo for the fast merge gate's end-to-end tests (ticket 31; a helper since ticket 83, so the
// runner's own test and this repo's ticket 64 test share it): a local bare remote, a clone with
// cloud branches and their CI reports, integration branches, and selfGate run on the clone in merge
// mode with the real onkel process. Only the tools behind it are fakes: the typecheck and test
// steps (the unit step writes the coverage and the vitest report a real run would), and Stryker, a
// stand-in in node_modules above the clone that records what it was asked to mutate and kills
// every mutant.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { MergeCheck } from '../../runner/merge-check.ts';
import { selfGate, type SelfGateIo } from '../../runner/self-gate-main.ts';
import type { Step } from '../../runner/self-gate-run.ts';

const REPO = resolve(import.meta.dirname, '..', '..');
/** Each test spawns git a dozen times and onkel once; under load on Windows that is slow. */
export const SPAWNS = 120_000;

/** Removes the temp folder. */
export const tearDown = () => rmSync(dir, { recursive: true, force: true });

export const BASE_SOURCE = [
  'export const LIMIT = 3;',
  'export function double(x: number) {',
  '  return x * 2;',
  '}',
  'export function triple(x: number) {',
  '  return x * 3;',
  '}',
  '',
].join('\n');

export const lineSet = (source: string, line: number, text: string) => source.split('\n').map((l, i) => (i === line - 1 ? text : l)).join('\n');

// A CommonJS stand-in for Stryker 10: writes a report with one killed mutant per `mutate` entry.
const FAKE_STRYKER = `
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
fs.appendFileSync(process.env.STRYKER_CALLS, JSON.stringify(config.mutate) + '\\n');
const files = {};
for (const entry of config.mutate) {
  const [file, range] = entry.split(':');
  files[file] = files[file] || { mutants: [] };
  files[file].mutants.push({ location: { start: { line: Number(range.split('-')[0]) } }, mutatorName: 'ArithmeticOperator', status: 'Killed' });
}
fs.writeFileSync(config.jsonReporter.fileName, JSON.stringify({ files }));
console.log('Found ' + Object.keys(files).length + ' of ' + Object.keys(files).length + ' file(s) to be mutated.');
`;

let dir: string;
let work: string;
const calls = () => join(dir, 'stryker-calls.jsonl');

/** The temp folder (its state/ holds the gate's log) and the clone the gate runs in. */
export const where = () => ({ dir, work });

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

export function commit(file: string, text: string, message: string): string {
  mkdirSync(dirname(join(work, file)), { recursive: true });
  writeFileSync(join(work, file), text);
  git(work, 'add', '--', file);
  git(work, 'commit', '-q', '-m', message);
  return git(work, 'rev-parse', 'HEAD');
}

export const green = (base: string, head: string) =>
  JSON.stringify({ branch: 'x', base, head, clean: true, verdict: 'pass', files: ['scripts/lib.ts'], mutants: { killed: 3, total: 3 }, survivors: [], suppressions: [], timeouts: { count: 0, waitMs: 0 }, highestCrap: 1, mutationSkipped: false });

/**
 * The bare remote, a clone, and the branches: main (the base, with the runner config: scripts/ is
 * graded, the CI reports are under cloud-runs/), two integration branches and three cloud
 * branches. `seed` adds files of its own to the base (written and staged in the clone), and
 * `more` branches of its own from it.
 */
export function setUp(hooks: { seed?: (work: string) => void; more?: (base: string) => void } = {}): void {
  dir = mkdtempSync(join(tmpdir(), 'merge-gate-'));
  const fakes = join(dir, 'node_modules');
  mkdirSync(join(fakes, '@stryker-mutator', 'core', 'bin'), { recursive: true });
  writeFileSync(join(fakes, '@stryker-mutator', 'core', 'package.json'), '{"name":"@stryker-mutator/core","version":"10.0.0"}');
  writeFileSync(join(fakes, '@stryker-mutator', 'core', 'bin', 'stryker.js'), FAKE_STRYKER);
  mkdirSync(join(fakes, 'vitest'), { recursive: true });
  writeFileSync(join(fakes, 'vitest', 'package.json'), '{"name":"vitest","version":"4.1.11"}');
  // typescript too: the typecheck step resolves tsc from the clone before the fake runner is asked,
  // and on Windows there is no global typescript for Node's lookup to fall back on.
  mkdirSync(join(fakes, 'typescript', 'bin'), { recursive: true });
  writeFileSync(join(fakes, 'typescript', 'package.json'), '{"name":"typescript","version":"5.9.0"}');
  writeFileSync(join(fakes, 'typescript', 'bin', 'tsc'), '');

  git(dir, 'init', '-q', '--bare', 'remote.git');
  git(dir, 'clone', '-q', 'remote.git', 'work');
  work = join(dir, 'work');
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(work, 'config', k, v);
  git(work, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(work, 'package.json'), '{"type":"module"}\n');
  mkdirSync(join(work, 'config'));
  writeFileSync(join(work, 'config', 'runner.json'), JSON.stringify({ sourceDirs: ['scripts'], report: { dir: 'cloud-runs' } }));
  git(work, 'add', 'package.json', 'config');
  hooks.seed?.(work);
  const base = commit('scripts/lib.ts', BASE_SOURCE, 'base');

  // ticket/7: a green cloud gate of its change, committed with its report after the gate.
  git(work, 'checkout', '-q', '-b', 'ticket/7', base);
  const gated = commit('scripts/lib.ts', lineSet(lineSet(BASE_SOURCE, 1, 'export const LIMIT = 4;'), 3, '  return x + x;'), 'ticket 7');
  commit('cloud-runs/ticket-7.gate.json', green(base, gated), 'carry back');
  // ticket/8: no report.
  git(work, 'checkout', '-q', '-b', 'ticket/8', base);
  commit('scripts/lib.ts', lineSet(BASE_SOURCE, 3, '  return x + x;'), 'ticket 8');
  // ticket/9: a report, then more code after the gate.
  git(work, 'checkout', '-q', '-b', 'ticket/9', base);
  const early = commit('scripts/lib.ts', lineSet(BASE_SOURCE, 3, '  return x + x;'), 'ticket 9');
  commit('cloud-runs/ticket-9.gate.json', green(base, early), 'carry back');
  commit('scripts/lib.ts', lineSet(lineSet(BASE_SOURCE, 3, '  return x + x;'), 6, '  return x + x + x;'), 'ticket 9, after its gate');

  hooks.more?.(base);
  // Two integration branches: one that leaves lib.ts alone, one whose LIMIT conflicts with ticket/7's.
  git(work, 'checkout', '-q', '-b', 'integration-clean', base);
  commit('docs/notes.md', 'notes\n', 'docs');
  git(work, 'checkout', '-q', '-b', 'integration-conflict', base);
  commit('scripts/lib.ts', lineSet(BASE_SOURCE, 1, 'export const LIMIT = 5;'), 'integration');
  git(work, 'push', '-q', 'origin', '--all');
}

/** Checks out an integration branch afresh and starts merging a cloud branch into it, as the controller does. */
export function startMerge(integration: string, branch: string): void {
  spawnSync('git', ['merge', '--abort'], { cwd: work });
  git(work, 'reset', '-q', '--hard');
  git(work, 'checkout', '-q', '-B', `merge-${branch.replace('/', '-')}`, `origin/${integration}`);
  spawnSync('git', ['merge', '-q', '--no-ff', '--no-commit', `origin/${branch}`], { cwd: work });
  rmSync(calls(), { force: true });
}

/** selfGate on the clone: real git and onkel, fake tests and Stryker, and the merge check given; what it printed and returned. */
export function gate(argv: string[], mergeCheck?: MergeCheck) {
  let out = '';
  let t = 0;
  const run = (step: Step): number | null => {
    if (step.id === 'unit') {
      const cov = step.args.find((a) => a.startsWith('--coverage.reportsDirectory='))!.split('=')[1];
      mkdirSync(cov, { recursive: true });
      writeFileSync(join(cov, 'coverage-final.json'), '{}');
      writeFileSync(step.args.find((a) => a.startsWith('--outputFile.json='))!.split('=')[1], JSON.stringify({ testResults: [{ name: join(work, 'scripts', 'lib.test.ts'), startTime: 0, endTime: 42 }] }));
    }
    if (step.id !== 'onkel') return 0;
    const r = spawnSync(process.execPath, [join(REPO, 'gates', 'onkel', 'run.ts'), ...step.args.slice(1)], { cwd: work, encoding: 'utf8', env: { ...process.env, STRYKER_CALLS: calls() } });
    out += r.stdout + r.stderr;
    return r.status;
  };
  const io: SelfGateIo = {
    root: work,
    git: (args) => spawnSync('git', args, { cwd: work, encoding: 'utf8' }),
    run,
    // The clone has no node_modules, so no dependency-cruiser: the selection fails closed, every test runs.
    // The self-gate only ever captures node (dependency-cruiser), so the helper runs node itself.
    capture: (_command, args) => spawnSync(process.execPath, args, { cwd: work, encoding: 'utf8' }),
    read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    write: (path, text) => writeFileSync(path, text),
    append: (path, text) => (mkdirSync(dirname(path), { recursive: true }), appendFileSync(path, text)),
    exists: existsSync,
    tempDir: () => mkdtempSync(join(dir, 'run-')),
    clock: () => (t += 1000),
    now: () => '2026-10-04T12:00:00.000Z',
    out: (text) => void (out += text),
    err: (text) => void (out += text),
    mergeCheck,
  };
  const exit = selfGate(argv, { WORKFLOW_STATE_DIR: join(dir, 'state') }, io);
  const mutated = existsSync(calls()) ? readFileSync(calls(), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) : [];
  return { exit, out, mutated };
}

