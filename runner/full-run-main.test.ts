import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseObservations, type Observation } from './observations.ts';
import { failedFiles, fullRun, type FullRunIo } from './full-run-main.ts';
import type { Step } from './self-gate-run.ts';

const ROOT = join(import.meta.dirname, '..');
const TMP = join('/tmp', 'full-1');
const STATE = join('/state');
const LOG = join(STATE, 'logs', 'observations.jsonl');
const SHA = 'f'.repeat(40);

const report = (results: [string, string][]) => JSON.stringify({ testResults: results.map(([file, status]) => ({ name: join(ROOT, ...file.split('/')), status })) });
const selection = (at: string, ticket: string, changed: string[], tests: string[]): Observation => ({ at, run: '', project: 'workflow', ticket, role: '', kind: 'selection', sha: 's', changed, all: false, reason: '', tests });

type Fake = { config?: string; locked?: boolean; merging?: boolean; exits?: Partial<Record<'unit' | 'integration', number | null>>; unit?: string; integration?: string; log?: Observation[] };

function fake(f: Fake = {}) {
  const ran: Step[] = [];
  const appended: [string, string][] = [];
  let out = '';
  let err = '';
  let t = 0;
  const files: Record<string, string | undefined> = {
    [join(TMP, 'unit.json')]: f.unit ?? report([['gates/a.test.ts', 'passed']]),
    [join(TMP, 'integration.json')]: f.integration ?? report([]),
    [LOG]: (f.log ?? []).map((o) => `${JSON.stringify(o)}\n`).join(''),
    [join(ROOT, 'config', 'runner.json')]: f.config,
  };
  const io: FullRunIo = {
    root: ROOT,
    git: (args) => {
      if (args.join(' ') === 'rev-parse -q --verify MERGE_HEAD') return { status: f.merging ? 0 : 1, stdout: '' };
      if (args.join(' ') === 'rev-parse HEAD') return { status: 0, stdout: `${SHA}\n` };
      throw new Error(`unexpected git ${args.join(' ')}`);
    },
    run: (step) => (ran.push(step), f.exits !== undefined && step.id in f.exits ? (f.exits[step.id as 'unit'] as number | null) : 0),
    read: (path) => files[path],
    append: (path, text) => void appended.push([path, text]),
    exists: (path) => f.locked === true && [join(STATE, 'runner.lock'), join(STATE, 'busy.lock')].includes(path),
    tempDir: () => TMP,
    clock: () => (t += 2000),
    now: () => '2026-10-06T02:00:00.000Z',
    out: (text) => void (out += text),
    err: (text) => void (err += text),
  };
  return { io, ran, appended, out: () => out, err: () => err };
}

const ENV = { WORKFLOW_STATE_DIR: STATE, WORKFLOW_PROJECT: 'workflow' };
const records = (g: ReturnType<typeof fake>) => parseObservations(g.appended.map(([, text]) => text).join(''));

describe('fullRun — the whole suite as the selection safety net (ticket 56)', () => {
  it('needs --why promote or idle', () => {
    for (const argv of [[], ['--why', 'later'], ['--when', 'idle']]) {
      const g = fake();
      expect(fullRun(argv, ENV, g.io)).toBe(2);
      expect(g.err()).toBe('usage: node scripts/full-run.ts --why promote|idle\n');
      expect(g.ran).toEqual([]);
    }
  });

  it('runs every unit and integration test with JSON reports, and records the run', () => {
    const g = fake();
    expect(fullRun(['--why', 'promote'], ENV, g.io)).toBe(0);
    expect(g.ran.map((s) => [s.id, s.name, s.command, s.args.slice(1)])).toEqual([
      ['unit', 'unit tests (all)', process.execPath, ['run', '--reporter=default', '--reporter=json', `--outputFile.json=${join(TMP, 'unit.json')}`]],
      ['integration', 'integration tests (all)', process.execPath, ['run', '--config', 'vitest.integration.config.ts', '--reporter=default', '--reporter=json', `--outputFile.json=${join(TMP, 'integration.json')}`]],
    ]);
    expect(g.appended.map(([path]) => path)).toEqual([LOG]);
    expect(records(g)).toEqual([{ at: '2026-10-06T02:00:00.000Z', run: '', project: 'workflow', ticket: '', role: '', kind: 'full-run', sha: SHA, why: 'promote', failing: [], ms: 4000 }]);
    expect(g.out()).toBe(['', 'Full run (promote):', '  pass  unit tests (all)  2.0 s', '  pass  integration tests (all)  2.0 s', '  0 test file(s) failed', ''].join('\n'));
  });

  it('records a selection miss: a failing test no merge since its last run selected', () => {
    const log = [selection('2026-10-05T10:00:00.000Z', 'ticket/a', ['gates/b.ts'], ['gates/b.test.ts'])];
    const g = fake({ log, exits: { integration: 1 }, integration: report([['gates/c.integration.test.ts', 'failed'], ['gates/b.test.ts', 'passed']]) });
    expect(fullRun(['--why', 'idle'], ENV, g.io)).toBe(1);
    expect(records(g)).toMatchObject([
      { kind: 'full-run', why: 'idle', failing: ['gates/c.integration.test.ts'] },
      { kind: 'selection-miss', sha: SHA, test: 'gates/c.integration.test.ts', merges: ['ticket/a'], changed: ['gates/b.ts'] },
    ]);
    expect(g.out()).toContain('  FAIL  integration tests (all)  2.0 s\n  1 test file(s) failed\n  SELECTION MISS  gates/c.integration.test.ts failed in the full run, and no merge since it last ran selected it (ticket/a); missing edge: gates/c.integration.test.ts depends on one of gates/b.ts\n');
  });

  it('a failing test the merges did select is no miss', () => {
    const log = [selection('2026-10-05T10:00:00.000Z', 'ticket/a', ['gates/b.ts'], ['gates/b.test.ts'])];
    const g = fake({ log, exits: { unit: 1 }, unit: report([['gates/b.test.ts', 'failed']]) });
    expect(fullRun(['--why', 'idle'], ENV, g.io)).toBe(1);
    expect(records(g)).toMatchObject([{ kind: 'full-run', failing: ['gates/b.test.ts'] }]);
  });

  it('exits 2 when a suite could not run', () => {
    const g = fake({ exits: { unit: null }, unit: undefined });
    expect(fullRun(['--why', 'promote'], ENV, g.io)).toBe(2);
  });

  it('when idle only: skips while a run holds the lock or a merge is under way', () => {
    const locked = fake({ locked: true });
    expect(fullRun(['--why', 'idle'], ENV, locked.io)).toBe(0);
    expect(locked.out()).toBe('full run skipped: a run is active (state/runner.lock)\n');
    expect(locked.ran).toEqual([]);
    const merging = fake({ merging: true });
    expect(fullRun(['--why', 'idle'], ENV, merging.io)).toBe(0);
    expect(merging.out()).toBe('full run skipped: a merge is in progress, so its gate may be running\n');
    expect(merging.appended).toEqual([]);
    const promote = fake({ locked: true, merging: true });
    fullRun(['--why', 'promote'], ENV, promote.io);
    expect(promote.ran).toHaveLength(2);
  });

  it('takes the busy lock, the state folder and the integration config from config/runner.json (ticket 83)', () => {
    const config = JSON.stringify({ busyLock: 'busy.lock', stateDir: 'runs', integrationTests: { config: 'vitest.int.ts' } });
    const locked = fake({ locked: true, config });
    expect(fullRun(['--why', 'idle'], ENV, locked.io)).toBe(0);
    expect(locked.out()).toBe('full run skipped: a run is active (runs/busy.lock)\n');
    const g = fake({ config });
    fullRun(['--why', 'promote'], {}, g.io);
    expect(g.ran[1].args.slice(0, 4)).toEqual([g.ran[1].args[0], 'run', '--config', 'vitest.int.ts']);
    expect(g.appended[0][0]).toBe(join(ROOT, 'runs', 'logs', 'observations.jsonl'));
  });

  it('cannot run on a broken config/runner.json, naming the field', () => {
    const g = fake({ config: '{"busyLock":1}' });
    expect(fullRun(['--why', 'idle'], ENV, g.io)).toBe(2);
    expect(g.err()).toBe('config/runner.json: busyLock is not a string\n');
    expect(g.ran).toEqual([]);
  });

  it("keeps its log in the default state folder without WORKFLOW_STATE_DIR", () => {
    const g = fake({ locked: true });
    fullRun(['--why', 'idle'], {}, g.io);
    expect(g.ran).toHaveLength(2);
    expect(g.appended[0][0]).toBe(join(ROOT, 'state', 'logs', 'observations.jsonl'));
  });
});

describe('failedFiles — the failed test files in a vitest JSON report', () => {
  it('by repo path, with Windows separators made forward', () => {
    const json = JSON.stringify({ testResults: [{ name: 'C:\\repo\\gates\\a.test.ts', status: 'failed' }, { name: 'C:\\repo\\gates\\b.test.ts', status: 'passed' }] });
    expect(failedFiles(json, 'C:\\repo')).toEqual(['gates/a.test.ts']);
  });

  it('none without a report', () => {
    expect(failedFiles(undefined, ROOT)).toEqual([]);
    expect(failedFiles('{"testResults": 4}', ROOT)).toEqual([]);
  });
});
