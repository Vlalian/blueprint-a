import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseObservations, type Observation, type ObservationBase } from './observations.ts';
import type { MergeCheck } from './merge-check.ts';
import { parseRunnerConfig } from './runner-config.ts';
import { onkelArgs } from './self-gate-core.ts';
import { selfGate, type SelfGateIo } from './self-gate-main.ts';
import { SHELLS } from './self-gate-shells.ts';
import { LS_SOURCES, SHELL_MARK } from './shells.ts';
import { cruiseArgs, LS_FILES } from './self-gate-select.ts';
import type { Step } from './self-gate-run.ts';

const ROOT = join(import.meta.dirname, '..');
const TMP = join('/tmp', 'gate-1');
const TIP = 'b'.repeat(40);
const HEAD = 'a'.repeat(40);
const BASE = 'c'.repeat(40);
const REPORT = 'cloud-runs/ticket-7.gate.json';
// The runner settings the fake repo has (config/runner.json, ticket 83).
const SETTINGS = {
  sourceDirs: ['gates', 'scripts'],
  graphDirs: ['gates', 'scripts', 'test'],
  strykerConfig: 'config/self-gate.json',
  report: { dir: 'cloud-runs', env: 'CI' },
  exempt: ['gates/onkel/run.ts', 'scripts/self-gate.ts'],
  sandboxIgnore: ['state'],
};
const CONFIG = parseRunnerConfig(JSON.stringify(SETTINGS));

const green = { branch: 'ticket/7', base: BASE, head: HEAD, clean: true, verdict: 'pass', files: ['scripts/a.ts'], mutants: { killed: 4, total: 4 }, survivors: [], suppressions: [], timeouts: { count: 0, waitMs: 0 }, highestCrap: 2, mutationSkipped: false };
const onkelResult = { verdict: 'pass', files: ['scripts/a.ts'], mutants: { killed: 7, total: 7 }, survivors: [], suppressions: [], timeouts: { count: 2, waitMs: 11_000 }, highestCrap: 4, mutationSkipped: false };
const vitestJson = JSON.stringify({ testResults: [{ name: join(ROOT, 'scripts', 'slow.test.ts'), startTime: 0, endTime: 4000 }, { name: join(ROOT, 'scripts', 'fast.test.ts'), startTime: 0, endTime: 100 }] });

const cruiseJson = (modules: Record<string, string[]>) =>
  JSON.stringify({ modules: Object.entries(modules).map(([source, deps]) => ({ source, dependencies: deps.map((resolved) => ({ resolved, dependencyTypes: ['local', 'import'] })) })) });

type Fake = {
  changed?: string;
  untracked?: string;
  report?: object | string | null;
  sinceGate?: string | null;
  baseOnBranch?: boolean;
  noTip?: boolean;
  status?: string;
  branch?: string;
  exits?: Partial<Record<Step['id'], number | null>>;
  diffFails?: boolean;
  /** git commands (args joined by spaces) that fail. */
  failing?: string[];
  noOnkelJson?: boolean;
  /** What the sast stage writes to its --json file (ticket 60); none when unset. */
  sastJson?: string;
  /** The repo's TypeScript files as git lists them, and their texts. */
  sources?: Record<string, string>;
  /** dependency-cruiser's modules and their imports (ticket 56); without them it fails, and every test runs. */
  cruise?: Record<string, string[]>;
  /** Every repo file as git lists them, beside the sources. */
  listing?: string[];
  /** config/runner.json's text; SETTINGS when unset. */
  config?: string;
  /** The repo's merge check, as the shell loaded it (ticket 83). */
  check?: MergeCheck | Error;
};

function fake(f: Fake = {}) {
  const ran: Step[] = [];
  const captured: string[][] = [];
  const written = new Map<string, string>();
  const appended: [string, string][] = [];
  let out = '';
  let err = '';
  let t = 0;
  const ok = (stdout: string) => ({ status: 0, stdout, stderr: '' });
  const no = { status: 1, stdout: '', stderr: 'fatal: no' };
  const git = (args: string[]) => {
    const a = args.join(' ');
    if (f.failing?.includes(a)) return no;
    if (a === 'diff --name-only base1 --') return f.diffFails ? no : ok(f.changed ?? 'scripts/a.ts\ndocs/x.md\n');
    if (a === 'ls-files --others --exclude-standard') return ok(f.untracked ?? '');
    if (a === 'rev-parse --verify origin/ticket/7^{commit}') return f.noTip ? no : ok(`${TIP}\n`);
    if (a.startsWith(`show ${TIP}:ci/`)) return no;
    if (a === `show ${TIP}:${REPORT}`) return f.report === null ? no : ok(typeof f.report === 'string' ? f.report : JSON.stringify(f.report ?? green));
    if (a === `diff --name-only ${HEAD} ${TIP}`) return f.sinceGate === null ? no : ok(f.sinceGate ?? 'cloud-runs/ticket-7.jsonl\n');
    if (a === `merge-base --is-ancestor ${BASE} HEAD`) return f.baseOnBranch === false ? no : ok('');
    if (a === 'rev-parse HEAD') return ok(`${HEAD}\n`);
    if (a === 'rev-parse --verify base1^{commit}') return ok(`${BASE}\n`);
    if (a === 'status --porcelain') return ok(f.status ?? '');
    if (a === 'rev-parse --abbrev-ref HEAD') return ok(f.branch ?? 'ticket/7\n');
    if (a === LS_SOURCES.join(' ')) return ok(Object.keys(f.sources ?? {}).join('\n'));
    if (a === LS_FILES.join(' ')) return ok([...(f.listing ?? []), ...Object.keys(f.sources ?? {}), ''].join('\n'));
    throw new Error(`unexpected git ${a}`);
  };
  const files: Record<string, string> = {
    [join(TMP, 'tests.json')]: vitestJson,
    ...(f.noOnkelJson ? {} : { [join(TMP, 'onkel.json')]: JSON.stringify(onkelResult) }),
    ...(f.sastJson === undefined ? {} : { [join(TMP, 'sast.json')]: f.sastJson }),
    [join(ROOT, 'config', 'self-gate.json')]: '{"stryker":{"timeoutMS":7000,"timeoutFactor":2}}',
    [join(ROOT, 'config', 'runner.json')]: f.config ?? JSON.stringify(SETTINGS),
    ...Object.fromEntries(Object.entries(f.sources ?? {}).map(([p, text]) => [join(ROOT, p), text])),
  };
  const io: SelfGateIo = {
    root: ROOT,
    git,
    run: (step) => (ran.push(step), f.exits !== undefined && step.id in f.exits ? (f.exits[step.id] as number | null) : 0),
    capture: (command, args) => (captured.push([command, ...args]), f.cruise === undefined ? { status: 2, stdout: '' } : { status: 0, stdout: cruiseJson(f.cruise) }),
    read: (path) => files[path],
    write: (path, text) => void written.set(path, text),
    append: (path, text) => void appended.push([path, text]),
    exists: (path) => !path.endsWith('gone.ts'),
    tempDir: () => TMP,
    clock: () => (t += 1500),
    now: () => '2026-10-04T12:00:00.000Z',
    out: (text) => void (out += text),
    err: (text) => void (err += text),
    mergeCheck: f.check,
  };
  return { io, ran, captured, written, appended, out: () => out, err: () => err };
}

const ENV = { WORKFLOW_STATE_DIR: '/state', WORKFLOW_PROJECT: 'workflow' };

it('forwards --merge to the locks CLI while HEAD is detached', () => {
  const g = fake({ branch: 'HEAD\n' });
  expect(selfGate(['--base', 'base1', '--merge', 'origin/ticket/7'], ENV, g.io)).toBe(0);
  expect(g.ran.find((s) => s.id === 'locks')?.args).toEqual([join(ROOT, 'gates', 'locks', 'cli.ts'), '--branch', 'origin/ticket/7']);
});
const onkelOf = (ran: Step[]) => ran.find((s) => s.id === 'onkel');
const flagValue = (step: Step | undefined, flag: string) => step?.args[step.args.indexOf(flag) + 1];

describe('selfGate — what it will not run without', () => {
  it('grades the change since the configured integration branch without --base (ticket 83)', () => {
    const g = fake({ config: JSON.stringify({ ...SETTINGS, integrationBranch: 'base1' }) });
    expect(selfGate([], ENV, g.io)).toBe(0);
    expect(flagValue(onkelOf(g.ran), '--base')).toBe('base1');
  });

  it('refuses a flag it does not know, with the usage', () => {
    const g = fake();
    expect(selfGate(['--base', 'base1', '--bogus'], ENV, g.io)).toBe(2);
    expect(g.err()).toBe('usage: node scripts/self-gate.ts [--base <ref>] [--integration] [--merge <branch>] [--report <branch>]\n');
    expect(g.ran).toEqual([]);
  });

  it('cannot run when git cannot diff against the base', () => {
    const g = fake({ diffFails: true });
    expect(selfGate(['--base', 'base1'], ENV, g.io)).toBe(2);
    expect(g.err()).toBe('git diff against base1 failed:\nfatal: no');
    expect(g.ran).toEqual([]);
  });
});

describe('selfGate — normal mode, as cloud sessions run it', () => {
  it('runs typecheck, the unit tests and onkel, which runs its own coverage; no merge flags', () => {
    const g = fake();
    expect(selfGate(['--base', 'base1'], ENV, g.io)).toBe(0);
    expect(g.ran.map((s) => s.id)).toEqual(['typecheck', 'unit', 'locks', 'onkel']);
    const onkel = onkelOf(g.ran);
    expect(onkel?.args).not.toContain('--coverage');
    expect(onkel?.args).not.toContain('--trust');
    expect(flagValue(onkel, '--json')).toBe(join(TMP, 'onkel.json'));
  });

  it("hands onkel the base, the changed source files, the shells' exemptions and the configured Stryker timeouts", () => {
    const g = fake({ changed: 'scripts/a.ts\nscripts/gone.ts\n', untracked: 'gates/new.ts\n' });
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(onkelOf(g.ran)).toEqual({
      id: 'onkel',
      name: 'onkel on 2 file(s)',
      command: process.execPath,
      args: [
        'gates/onkel/run.ts',
        ...onkelArgs('base1', ['scripts/a.ts', 'gates/new.ts'], CONFIG),
        ...SHELLS.flatMap((s) => ['--exempt', s]),
        ...['--timeout-ms', '7000', '--timeout-factor', '2', '--json', join(TMP, 'onkel.json')],
      ],
    });
  });

  it('exempts a shell that declares itself in its own file as well as the listed ones (ticket 56)', () => {
    const g = fake({ sources: { 'scripts/new-cli.ts': `${SHELL_MARK}\n`, 'scripts/a.ts': 'export {};\n' } });
    selfGate(['--base', 'base1'], ENV, g.io);
    const args = onkelOf(g.ran)?.args ?? [];
    expect(args.join(' ')).toContain(`--exempt ${SHELLS.at(-1)} --exempt scripts/new-cli.ts --timeout-ms`);
  });

  it('logs one record per stage and no selection', () => {
    const g = fake();
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(g.appended[0][1].trim().split('\n')).toHaveLength(4);
  });

  it('runs no onkel when no source file changed', () => {
    const g = fake({ changed: 'docs/x.md\n' });
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(g.ran.map((s) => s.id)).toEqual(['typecheck', 'unit', 'locks']);
  });

  it('runs the integration tests only with --integration, whatever changed', () => {
    const g = fake({ changed: 'gates/onkel/cli.ts\n' });
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(g.ran.map((s) => s.id)).not.toContain('integration');
    const h = fake({ changed: 'docs/x.md\n' });
    selfGate(['--base', 'base1', '--integration'], ENV, h.io);
    expect(h.ran.map((s) => s.id)).toContain('integration');
  });

  it('exits with the worst stage', () => {
    expect(selfGate(['--base', 'base1'], ENV, fake({ exits: { unit: 1 } }).io)).toBe(1);
    expect(selfGate(['--base', 'base1'], ENV, fake({ exits: { unit: 1, onkel: null } }).io)).toBe(2);
  });
});

describe('selfGate --merge — the fast merge gate (ticket 31)', () => {
  const MERGE = ['--base', 'base1', '--merge', 'origin/ticket/7'];

  it('runs the unit suite once, with coverage, and onkel grades CRAP from that coverage', () => {
    const g = fake();
    selfGate(MERGE, ENV, g.io);
    // No module graph in this fake: the selection fails closed and every test runs (ticket 56).
    expect(g.ran.map((s) => s.id)).toEqual(['typecheck', 'unit', 'property', 'integration', 'locks', 'sast', 'onkel']);
    const unit = g.ran.filter((s) => s.id === 'unit');
    expect(unit).toHaveLength(1);
    expect(unit[0].args).toContain('--coverage.enabled');
    expect(unit[0].args).toContain(`--coverage.reportsDirectory=${join(TMP, 'coverage')}`);
    expect(flagValue(onkelOf(g.ran), '--coverage')).toBe(join(TMP, 'coverage', 'coverage-final.json'));
  });

  it('trusts a valid green CI report: onkel mutates only the lines that differ from the tip, and the summary says so', () => {
    const g = fake();
    selfGate(MERGE, ENV, g.io);
    expect(flagValue(onkelOf(g.ran), '--trust')).toBe(TIP);
    expect(g.out()).toContain(`mutation: only the lines that differ from bbbbbbbb; the rest is trusted from ${REPORT} (gated aaaaaaaa, 4/4 mutants killed)`);
  });

  it('falls back to full changed-line mutation, with the reason printed, when the report is missing', () => {
    const g = fake({ report: null });
    selfGate(MERGE, ENV, g.io);
    expect(onkelOf(g.ran)?.args).not.toContain('--trust');
    expect(g.out()).toContain(`mutation: every changed line (no trusted CI report: no ${REPORT} on the branch)`);
  });

  it('falls back when the report is stale: code changed on the branch after its gate', () => {
    const g = fake({ sinceGate: 'scripts/a.ts\ncloud-runs/ticket-7.jsonl\n' });
    selfGate(MERGE, ENV, g.io);
    expect(onkelOf(g.ran)?.args).not.toContain('--trust');
    expect(g.out()).toContain('no trusted CI report: stale: it gated aaaaaaaa, and the tip bbbbbbbb changed scripts/a.ts since');
  });

  it('without a trusted report, hands onkel only the coverage', () => {
    const g = fake({ report: null });
    selfGate(MERGE, ENV, g.io);
    expect(onkelOf(g.ran)?.args.slice(-4)).toEqual(['--json', join(TMP, 'onkel.json'), '--coverage', join(TMP, 'coverage', 'coverage-final.json')]);
  });

  it('falls back when git cannot compare the gated commit with the tip', () => {
    const g = fake({ sinceGate: null });
    selfGate(MERGE, ENV, g.io);
    expect(g.out()).toContain('stale: git cannot compare its gated commit aaaaaaaa with the tip bbbbbbbb');
  });

  it('falls back when the report is red, or its base is not on the branch merged into', () => {
    const red = fake({ report: { ...green, survivors: [{ file: 'a', line: 1, mutator: 'm', status: 'Survived' }] } });
    selfGate(MERGE, ENV, red.io);
    expect(red.out()).toContain('no trusted CI report: red: 1 surviving mutant(s)');
    const base = fake({ baseOnBranch: false });
    selfGate(MERGE, ENV, base.io);
    expect(base.out()).toContain('no trusted CI report: it graded the change since cccccccc');
  });

  it('falls back when the report is not a gate report', () => {
    const g = fake({ report: 'oops' });
    selfGate(MERGE, ENV, g.io);
    expect(g.out()).toContain(`no trusted CI report: ${REPORT} is not a gate report`);
  });

  it('falls back when git cannot find the branch', () => {
    const g = fake({ noTip: true });
    selfGate(MERGE, ENV, g.io);
    expect(onkelOf(g.ran)?.args).not.toContain('--trust');
    expect(g.out()).toContain('no trusted CI report: git cannot find the branch origin/ticket/7');
  });

  // A graph: lib.ts is imported by mid.ts, mid.ts by top.ts; each has its own test, and an
  // integration test spawns cli.ts, which imports top.ts.
  const CRUISE = {
    'scripts/a.ts': [],
    'scripts/a.test.ts': ['scripts/a.ts'],
    'gates/lib.ts': [],
    'gates/mid.ts': ['gates/lib.ts'],
    'gates/top.ts': ['gates/mid.ts'],
    'gates/cli.ts': ['gates/top.ts'],
    'gates/lib.test.ts': ['gates/lib.ts'],
    'gates/mid.test.ts': ['gates/mid.ts'],
    'gates/top.property.test.ts': ['gates/top.ts'],
    'gates/cli.integration.test.ts': [],
    'gates/other.integration.test.ts': [],
  };
  const SPAWNING = { 'gates/cli.integration.test.ts': "spawnSync(process.execPath, [join(ROOT, 'gates', 'cli.ts')]);\n" };
  const selected = (changed: string, extra: string[] = []) => {
    const g = fake({ changed, cruise: CRUISE, sources: SPAWNING, listing: Object.keys(CRUISE) });
    const exit = selfGate([...MERGE, ...extra], ENV, g.io);
    const args = (id: string) => g.ran.find((s) => s.id === id)?.args.filter((a) => /^[\w/.-]+\.test\.ts$/.test(a));
    return { g, exit, ids: g.ran.map((s) => s.id), unit: args('unit'), property: args('property'), integration: args('integration') };
  };

  it('runs only the unit, property and integration tests the change reaches, and onkel grades their coverage (ticket 56)', () => {
    const r = selected('gates/lib.ts\n');
    expect(r.unit).toEqual(['gates/lib.test.ts', 'gates/mid.test.ts']);
    expect(r.property).toEqual(['gates/top.property.test.ts']);
    expect(r.integration).toEqual(['gates/cli.integration.test.ts']);
    expect(flagValue(onkelOf(r.g.ran), '--coverage')).toBe(join(TMP, 'coverage', 'coverage-final.json'));
    expect(r.g.out()).toContain('tests: 3 unit and 1 integration test file(s) the change can reach, by dependency-cruiser');
    expect(r.exit).toBe(0);
  });

  it('runs dependency-cruiser from the root with the repo config, as node <entry>', () => {
    const r = selected('gates/lib.ts\n');
    expect(r.g.captured).toEqual([[process.execPath, join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs'), ...cruiseArgs(['gates', 'scripts', 'test'])]]);
  });

  it('skips a stage the selection leaves empty; without a unit run onkel measures its own coverage', () => {
    const r = selected('scripts/a.ts\n');
    expect(r.ids).toEqual(['typecheck', 'unit', 'locks', 'sast', 'onkel']);
    const t = selected('gates/top.ts\n');
    expect(t.ids).toEqual(['typecheck', 'property', 'integration', 'locks', 'sast', 'onkel']);
    const after = (g: ReturnType<typeof fake>) => {
      const args = onkelOf(g.ran)?.args ?? [];
      return args.slice(args.indexOf('--json') + 2);
    };
    expect(after(t.g)).toEqual(['--trust', TIP]);
    const untrusted = fake({ changed: 'gates/top.ts\n', cruise: CRUISE, listing: Object.keys(CRUISE), noTip: true });
    selfGate(MERGE, ENV, untrusted.io);
    expect(after(untrusted)).toEqual([]);
    const covered = fake({ changed: 'scripts/a.ts\n', cruise: CRUISE, listing: Object.keys(CRUISE), noTip: true });
    selfGate(MERGE, ENV, covered.io);
    expect(after(covered)).toEqual(['--coverage', join(TMP, 'coverage', 'coverage-final.json')]);
  });

  it('runs every integration test with --integration, the unit tests still selected', () => {
    const r = selected('scripts/a.ts\n', ['--integration']);
    expect(r.unit).toEqual(['scripts/a.test.ts']);
    expect(r.ids).toContain('integration');
    expect(r.integration).toEqual([]);
  });

  it('runs everything, and says why, when the graph cannot be built', () => {
    const g = fake({ changed: 'gates/lib.ts\n' });
    selfGate(MERGE, ENV, g.io);
    expect(g.ran.find((s) => s.id === 'integration')?.args.slice(-2)).toEqual(['--config', 'vitest.integration.config.ts']);
    expect(g.out()).toContain('tests: all of them (the module graph could not be built: dependency-cruiser gave no JSON)');
  });

  it('fails on a changed source file no test reaches, but not on a process shell', () => {
    const cruise = { ...CRUISE, 'gates/lonely.ts': [], 'gates/shell.ts': [], 'scripts/self-gate.ts': [] };
    const g = fake({ changed: 'gates/lonely.ts\ngates/shell.ts\nscripts/self-gate.ts\n', cruise, sources: { 'gates/shell.ts': `${SHELL_MARK}\n` } });
    expect(selfGate(MERGE, ENV, g.io)).toBe(1);
    expect(g.out()).toContain('  FINDING  gates/lonely.ts changed, and no test reaches it');
    expect(g.out()).not.toContain('gates/shell.ts changed');
    expect(g.out()).not.toContain('scripts/self-gate.ts changed');
  });

  it('leaves out a changed file of types only: nothing in it can run', () => {
    const cruise = { ...CRUISE, 'gates/types.ts': [] };
    const g = fake({ changed: 'gates/types.ts\n', cruise, sources: { 'gates/types.ts': 'export type T = { a: string };\n' } });
    selfGate(MERGE, ENV, g.io);
    expect(g.out()).not.toContain('gates/types.ts changed');
  });

  it('logs the selection with the stages, under the merged branch', () => {
    const r = selected('gates/mid.ts\n');
    const log = parseObservations(r.g.appended[0][1]);
    expect(log.find((o) => o.kind === 'selection')).toMatchObject({ ticket: 'origin/ticket/7', sha: HEAD, changed: ['gates/mid.ts'], all: false, reason: '', tests: ['gates/mid.test.ts', 'gates/top.property.test.ts', 'gates/cli.integration.test.ts'] });
  });


  it('logs its stages under the merged branch when the run names no ticket', () => {
    const g = fake();
    selfGate(MERGE, ENV, g.io);
    expect(parseObservations(g.appended[0][1]).every((r) => r.ticket === 'origin/ticket/7')).toBe(true);
    const h = fake();
    selfGate(MERGE, { ...ENV, WORKFLOW_TICKET: '31' }, h.io);
    expect(parseObservations(h.appended[0][1]).every((r) => r.ticket === '31')).toBe(true);
  });
});

describe('selfGate — stage times', () => {
  it('appends one gate observation per stage with its ms and verdict, the unit stage with the slowest test files', () => {
    const g = fake({ exits: { onkel: 1 } });
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(g.appended.map(([path]) => path)).toEqual([join('/state', 'logs', 'observations.jsonl')]);
    const records = parseObservations(g.appended[0][1]);
    expect(records.map((r) => r.kind === 'gate' && [r.gate, r.verdict, r.ms, r.sha])).toEqual([
      ['self-gate-typecheck', 'pass', 1500, HEAD],
      ['self-gate-unit', 'pass', 1500, HEAD],
      ['self-gate-locks', 'pass', 1500, HEAD],
      ['self-gate-onkel', 'fail', 1500, HEAD],
    ]);
    expect(records[1]).toMatchObject({ project: 'workflow', slowest: [{ file: 'scripts/slow.test.ts', ms: 4000 }, { file: 'scripts/fast.test.ts', ms: 100 }] });
    expect(records[0]).not.toHaveProperty('slowest');
  });

  it('logs no ticket outside a merge when the run names none, and no sha when git cannot read HEAD', () => {
    const g = fake({ failing: ['rev-parse HEAD'] });
    selfGate(['--base', 'base1'], {}, g.io);
    expect(parseObservations(g.appended[0][1]).map((r) => [r.ticket, r.kind === 'gate' && r.sha])).toEqual([
      ['', ''],
      ['', ''],
      ['', ''],
      ['', ''],
    ]);
  });

  it("logs to this repo's state folder when the run names none", () => {
    const g = fake();
    selfGate(['--base', 'base1'], {}, g.io);
    expect(g.appended[0][0]).toBe(join(ROOT, 'state', 'logs', 'observations.jsonl'));
  });

  it("prints each stage's verdict and time, the total, onkel's kills, Stryker's timeouts and the slowest test files", () => {
    const g = fake();
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(g.out()).toBe(
      [
        '',
        'Self-gate:',
        '  pass  typecheck  1.5 s',
        '  pass  unit tests  1.5 s',
        '  pass  locked files  1.5 s',
        '  pass  onkel on 1 file(s)  1.5 s',
        '  total  6.0 s',
        'onkel: 7/7 mutants killed, highest CRAP 4',
        'Stryker timeouts: 2 mutant(s) timed out, waiting at most 11.0 s in all',
        'Slowest test files:',
        '  4.0 s  scripts/slow.test.ts',
        '  0.1 s  scripts/fast.test.ts',
        '',
      ].join('\n'),
    );
  });

  it('prints no onkel lines when onkel did not run', () => {
    const g = fake({ changed: 'docs/x.md\n' });
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(g.out()).toBe(
      ['', 'Self-gate:', '  pass  typecheck  1.5 s', '  pass  unit tests  1.5 s', '  pass  locked files  1.5 s', '  total  4.5 s', 'Slowest test files:', '  4.0 s  scripts/slow.test.ts', '  0.1 s  scripts/fast.test.ts', ''].join('\n'),
    );
  });

  it('prints no onkel lines when onkel ran but wrote no result, and its report says nothing was graded', () => {
    const g = fake({ noOnkelJson: true, exits: { onkel: 2 } });
    expect(selfGate(['--base', 'base1', '--report', 'ticket/7'], ENV, g.io)).toBe(2);
    expect(g.out()).not.toContain('onkel:');
    expect(JSON.parse(g.written.get(join(ROOT, 'cloud-runs', 'ticket-7.gate.json')) ?? '')).toMatchObject({ verdict: 'fail', files: [], mutants: { killed: 0, total: 0 } });
  });
});

describe('selfGate — the CI report', () => {
  it('writes cloud-runs/<branch>.gate.json for --report: what onkel found, with base, head, clean and the verdict', () => {
    const g = fake({ status: ' M docs/x.md\n' });
    selfGate(['--base', 'base1', '--report', 'ticket/7'], ENV, g.io);
    expect(JSON.parse(g.written.get(join(ROOT, 'cloud-runs', 'ticket-7.gate.json')) ?? '')).toEqual({ ...onkelResult, branch: 'ticket/7', base: BASE, head: HEAD, clean: true, verdict: 'pass' });
    expect(g.out()).toContain('gate report: cloud-runs/ticket-7.gate.json');
  });

  it('writes it in a CI run for the checked-out branch, failed when a stage failed', () => {
    const g = fake({ exits: { unit: 1 }, branch: 'ticket/9\n' });
    selfGate(['--base', 'base1'], { CI: 'true' }, g.io);
    expect(JSON.parse(g.written.get(join(ROOT, 'cloud-runs', 'ticket-9.gate.json')) ?? '')).toMatchObject({ branch: 'ticket/9', verdict: 'fail' });
  });

  it('writes the base as given, and an unclean tree, when git cannot resolve them', () => {
    const g = fake({ failing: ['rev-parse --verify base1^{commit}', 'status --porcelain'] });
    selfGate(['--base', 'base1', '--report', 'ticket/7'], ENV, g.io);
    expect(JSON.parse(g.written.get(join(ROOT, 'cloud-runs', 'ticket-7.gate.json')) ?? '')).toMatchObject({ base: 'base1', clean: false });
  });

  it('writes none in a CI run when git cannot name the branch', () => {
    const g = fake({ failing: ['rev-parse --abbrev-ref HEAD'] });
    selfGate(['--base', 'base1'], { CI: 'true' }, g.io);
    expect(g.written.size).toBe(0);
  });

  it('writes none in merge mode: a merge gate trusts lines, it does not vouch for them', () => {
    const g = fake();
    selfGate(['--base', 'base1', '--merge', 'origin/ticket/7', '--report', 'ticket/7'], { CI: 'true' }, g.io);
    expect(g.written.size).toBe(0);
  });

  it('writes none outside CI without --report', () => {
    const g = fake();
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(g.written.size).toBe(0);
  });
});

describe('selfGate --merge — the sast stage (ticket 60)', () => {
  const MERGE = ['--base', 'base1', '--merge', 'origin/ticket/7'];
  const finding = { rule: 'javascript.lang.security.detect-child-process', severity: 'ERROR', file: 'scripts/a.ts', line: 3, message: 'child process' };
  const result = { gate: 'sast', pass: false, scanned: ['scripts/a.ts'], findings: [finding], warnings: [{ ...finding, severity: 'WARNING', line: 8 }], suppressed: [] };
  const records = (g: ReturnType<typeof fake>) => parseObservations(g.appended.map(([, text]) => text).join(''));

  it('runs Semgrep on the changes since the base, before onkel, writing its JSON to the run folder', () => {
    const g = fake();
    selfGate(MERGE, ENV, g.io);
    expect(g.ran.find((s) => s.id === 'sast')).toEqual({ id: 'sast', name: 'sast (Semgrep security rules on the changed files)', command: process.execPath, args: ['gates/sast/cli.ts', '--base', 'base1', '--json', join(TMP, 'sast.json')] });
  });

  it('is not a stage of normal mode', () => {
    const g = fake({ sastJson: JSON.stringify(result) });
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(g.ran.map((s) => s.id)).not.toContain('sast');
    expect(records(g).filter((r) => r.kind === 'finding')).toEqual([]);
  });

  it('fails the gate on a blocking finding, names it in the summary, and logs each finding as a sast observation', () => {
    const g = fake({ sastJson: JSON.stringify(result), exits: { sast: 1 } });
    expect(selfGate(MERGE, ENV, g.io)).toBe(1);
    expect(g.out()).toContain('  FAIL  sast (Semgrep security rules on the changed files)');
    expect(g.out()).toContain('sast: BLOCKING scripts/a.ts:3 javascript.lang.security.detect-child-process (ERROR): child process');
    expect(g.out()).toContain('sast: reported scripts/a.ts:8 javascript.lang.security.detect-child-process (WARNING): child process');
    const found = records(g).filter((r) => r.kind === 'finding');
    expect(found.map((r) => [r.kind === 'finding' && r.source, r.kind === 'finding' && r.fate, r.kind === 'finding' && r.line])).toEqual([
      ['sast', 'blocking', 3],
      ['sast', 'reported', 8],
    ]);
    expect(found[0]).toMatchObject({ project: 'workflow', ticket: 'origin/ticket/7', sha: HEAD, gate: 'sast' });
    expect(records(g).some((r) => r.kind === 'gate' && r.gate === 'self-gate-sast' && r.verdict === 'fail')).toBe(true);
  });

  it('says why when Semgrep could not run, and logs no findings', () => {
    const g = fake({ sastJson: JSON.stringify({ gate: 'sast', pass: false, error: 'Semgrep is not installed' }), exits: { sast: 2 } });
    expect(selfGate(MERGE, ENV, g.io)).toBe(2);
    expect(g.out()).toContain('sast: could not run: Semgrep is not installed');
    expect(records(g).filter((r) => r.kind === 'finding')).toEqual([]);
  });

  it('reads no sast result that is missing or not the sast gate\'s', () => {
    for (const sastJson of [undefined, '{"gate":"other","findings":[{"rule":"x"}]}', 'nope']) {
      const g = fake({ sastJson });
      selfGate(MERGE, ENV, g.io);
      expect(g.out()).not.toContain('sast:');
      expect(records(g).filter((r) => r.kind === 'finding')).toEqual([]);
    }
  });
});

describe('selfGate --merge — the repo merge check config/runner.json names (ticket 83)', () => {
  const MERGE = ['--base', 'base1', '--merge', 'origin/ticket/7'];
  const record = (b: ObservationBase): Observation => ({ ...b, kind: 'gate', gate: 'merge-check', sha: TIP, verdict: 'pass' as const, reasons: [], ms: 0 });
  const asked: string[][] = [];
  const check = (refused: boolean): MergeCheck => (branch, base, git) => {
    asked.push([branch, base, String(git(['rev-parse', 'HEAD']))]);
    return { lines: refused ? ['Merge refused: not chosen.', ''] : [], refused, records: (b) => [record(b)] };
  };
  const checked = (g: ReturnType<typeof fake>) => g.appended.flatMap(([, text]) => parseObservations(text)).filter((o) => o.kind === 'gate' && o.gate === 'merge-check');

  it('asks it with the branch, the base and git; a refusal is printed first and fails the gate, which still runs', () => {
    asked.length = 0;
    const g = fake({ check: check(true) });
    expect(selfGate(MERGE, ENV, g.io)).toBe(1);
    expect(asked).toEqual([['origin/ticket/7', 'base1', `${HEAD}\n`]]);
    expect(g.err()).toBe('Merge refused: not chosen.\n');
    expect(g.ran.map((s) => s.id)).toContain('onkel');
    expect(checked(g)).toEqual([]);
  });

  it('keeps a gate that could not run at 2 when the merge is also refused', () => {
    expect(selfGate(MERGE, ENV, fake({ check: check(true), exits: { typecheck: null } }).io)).toBe(2);
  });

  it("logs the records of a merge it passes in the run's state folder", () => {
    const g = fake({ check: check(false) });
    expect(selfGate(MERGE, ENV, g.io)).toBe(0);
    expect(g.err()).toBe('');
    expect(checked(g)).toEqual([record({ at: '2026-10-04T12:00:00.000Z', run: '', project: 'workflow', ticket: '', role: '' })]);
    expect(g.appended.filter(([, text]) => text.includes('merge-check')).map(([path]) => path)).toEqual([join('/state', 'logs', 'observations.jsonl')]);
  });

  it('logs nothing when the gate is red, and asks nothing outside merge mode or without a check', () => {
    const red = fake({ check: check(false), exits: { unit: 1 } });
    expect(selfGate(MERGE, ENV, red.io)).toBe(1);
    expect(checked(red)).toEqual([]);
    expect(red.appended).toHaveLength(1);
    asked.length = 0;
    selfGate(['--base', 'base1'], ENV, fake({ check: check(true) }).io);
    expect(asked).toEqual([]);
    expect(selfGate(MERGE, ENV, fake().io)).toBe(0);
  });

  it("logs under the configured state folder when the run names none", () => {
    const g = fake({ check: check(false), config: JSON.stringify({ ...SETTINGS, stateDir: 'runs' }) });
    selfGate(MERGE, {}, g.io);
    expect(g.appended.filter(([, text]) => text.includes('merge-check')).map(([path]) => path)).toEqual([join(ROOT, 'runs', 'logs', 'observations.jsonl')]);
  });

  it('cannot run when the check could not be loaded, saying why', () => {
    const g = fake({ check: new Error('config/runner.json: mergeCheck x.ts exports no mergeCheck function') });
    expect(selfGate(MERGE, ENV, g.io)).toBe(2);
    expect(g.err()).toBe('config/runner.json: mergeCheck x.ts exports no mergeCheck function\n');
    expect(g.ran).toEqual([]);
  });
});

describe('selfGate — config/runner.json (ticket 83)', () => {
  const MERGE = ['--base', 'base1', '--merge', 'origin/ticket/7'];

  it('cannot run on a broken config, naming the field', () => {
    const g = fake({ config: '{"crapLimit":"six"}' });
    expect(selfGate(['--base', 'base1'], ENV, g.io)).toBe(2);
    expect(g.err()).toBe('config/runner.json: crapLimit is not a number\n');
    expect(g.ran).toEqual([]);
  });

  it('grades only the configured source folders, at the configured CRAP limit', () => {
    const g = fake({ changed: 'scripts/a.ts\nlib/b.ts\n', config: JSON.stringify({ ...SETTINGS, sourceDirs: ['lib'], crapLimit: 4 }) });
    selfGate(['--base', 'base1'], ENV, g.io);
    expect(onkelOf(g.ran)?.name).toBe('onkel on 1 file(s)');
    expect(flagValue(onkelOf(g.ran), '--crap-ceiling')).toBe('4');
    expect(onkelOf(g.ran)?.args).toContain('lib/b.ts');
  });

  it('takes no mutation result from a CI report when the config trusts none', () => {
    const g = fake({ config: JSON.stringify({ ...SETTINGS, report: { dir: 'cloud-runs', trusted: [] } }) });
    selfGate(MERGE, ENV, g.io);
    expect(onkelOf(g.ran)?.args).not.toContain('--trust');
    expect(g.out()).toContain('mutation: every changed line (no trusted CI report: config/runner.json trusts no mutation result from a CI report)');
  });

  it('reads and writes the CI report in the configured folder, with the configured integration config', () => {
    const g = fake({ config: JSON.stringify({ ...SETTINGS, report: { dir: 'ci' }, integrationTests: { suffix: '.int.test.ts', config: 'vitest.int.ts' } }) });
    selfGate(MERGE, ENV, g.io);
    expect(g.out()).toContain('no trusted CI report: no ci/ticket-7.gate.json on the branch');
    expect(g.ran.find((s) => s.id === 'integration')?.args.slice(-2)).toEqual(['--config', 'vitest.int.ts']);
    const h = fake({ config: JSON.stringify({ ...SETTINGS, report: { dir: 'ci' } }) });
    selfGate(['--base', 'base1', '--report', 'ticket/7'], ENV, h.io);
    expect([...h.written.keys()]).toEqual([join(ROOT, 'ci', 'ticket-7.gate.json')]);
  });

  it('names the CI report by the configured pattern on both sides', () => {
    const config = JSON.stringify({ ...SETTINGS, report: { dir: 'ci', name: 'gate-{branch}.json' } });
    const g = fake({ config });
    selfGate(MERGE, ENV, g.io);
    expect(g.out()).toContain('no trusted CI report: no ci/gate-ticket-7.json on the branch');
    const h = fake({ config });
    selfGate(['--base', 'base1', '--report', 'ticket/7'], ENV, h.io);
    expect([...h.written.keys()]).toEqual([join(ROOT, 'ci', 'gate-ticket-7.json')]);
  });

  it('writes a pipeline ref (refs/heads/ticket/7) to the report the merge of origin/ticket/7 reads', () => {
    const h = fake();
    selfGate(['--base', 'base1', '--report', 'refs/heads/ticket/7'], ENV, h.io);
    expect([...h.written.keys()]).toEqual([join(ROOT, REPORT)]);
    const g = fake();
    selfGate(MERGE, ENV, g.io);
    expect(g.out()).toContain(`the rest is trusted from ${REPORT}`);
  });

  it('runs on the defaults when the repo has no config/runner.json', () => {
    const g = fake({ changed: 'src/a.ts\n' });
    const files = g.io.read;
    g.io.read = (path) => (path === join(ROOT, 'config', 'runner.json') ? undefined : files(path));
    expect(selfGate(['--base', 'base1'], ENV, g.io)).toBe(0);
    expect(flagValue(onkelOf(g.ran), '--crap-ceiling')).toBe('6');
  });
});
