import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './runner-config.ts';
import { changedPaths, gradableFiles, onkelArgs, selfOnkelFlags, slowestTestFiles, slowLines, stageObservations, timeoutArgs } from './self-gate-core.ts';

const always = () => true;
const DIRS = ['gates', 'adapters', 'dispatcher', 'briefing', 'scripts', 'watchers'];
const CONFIG = { ...DEFAULTS, exempt: ['gates/onkel/run.ts', 'scripts/self-gate.ts'], sandboxIgnore: ['state', '/fixtures/*'], crapLimit: 5 };

describe('gradableFiles', () => {
  it('keeps changed source .ts files and drops tests, fixtures, state, docs and deleted paths', () => {
    const changed = [
      'gates/onkel/policy.ts',
      'gates/onkel/policy.test.ts',
      'gates/onkel/bites.integration.test.ts',
      'fixtures/sample-project/src/is-even.ts',
      'state/tmp/x.ts',
      'docs/PLAN.md',
      'dispatcher/outcome.ts',
      'vitest.config.ts',
    ];
    expect(gradableFiles(changed, (p) => p !== 'dispatcher/outcome.ts', DIRS)).toEqual(['gates/onkel/policy.ts']);
  });

  it('grades .ts files in every configured source folder, and none outside them', () => {
    const sources = ['gates/a.ts', 'adapters/a.ts', 'dispatcher/a.ts', 'briefing/a.ts', 'scripts/a.ts', 'watchers/a.ts'];
    expect(gradableFiles(sources, always, DIRS)).toEqual(sources);
    expect(gradableFiles([...sources, 'src/a.ts'], always, ['src'])).toEqual(['src/a.ts']);
  });

  it('drops files that are not TypeScript, even inside a source folder', () => {
    expect(gradableFiles(['gates/onkel/README.md', 'scripts/run.js', 'gates/x.tsx'], always, DIRS)).toEqual([]);
  });

  it('matches a source folder only as the first path segment', () => {
    expect(gradableFiles(['fixtures/gates/a.ts', 'gatesx/a.ts', 'gates.ts', 'projects/scripts/a.ts'], always, DIRS)).toEqual([]);
  });
});

describe('onkelArgs', () => {
  it('grades the change against the base, exempting the configured shells, keeping its folders out of the sandbox, at its CRAP limit', () => {
    expect(onkelArgs('abc123', ['gates/onkel/policy.ts', 'scripts/a.ts'], CONFIG)).toEqual([
      '--base',
      'abc123',
      ...['--exempt', 'gates/onkel/run.ts', '--exempt', 'scripts/self-gate.ts'],
      ...['--sandbox-ignore', 'state', '--sandbox-ignore', '/fixtures/*'],
      ...['--crap-ceiling', '5'],
      'gates/onkel/policy.ts',
      'scripts/a.ts',
    ]);
    expect(onkelArgs('b', [], DEFAULTS)).toEqual(['--base', 'b', '--crap-ceiling', '6']);
  });
});

describe("selfOnkelFlags — the self-gate onkel flags the workflow project's hardener check adds (ticket 41)", () => {
  it("are onkelArgs' exemptions and sandbox ignores, then the shells' exemptions and the configured Stryker timeouts", () => {
    expect(selfOnkelFlags(['scripts/pr.ts'], '{"stryker":{"timeoutMS":7000}}', CONFIG)).toEqual([
      ...onkelArgs('b', [], CONFIG).slice(2),
      ...['--exempt', 'scripts/pr.ts', '--timeout-ms', '7000'],
    ]);
    expect(selfOnkelFlags([], undefined, CONFIG)).toEqual(onkelArgs('b', [], CONFIG).slice(2));
  });
});

describe('changedPaths', () => {
  it('joins the files git diff names with the untracked ones, each once', () => {
    expect(changedPaths('gates/a.ts\nscripts/b.ts\n', 'gates/new.ts\ngates/a.ts\n')).toEqual(['gates/a.ts', 'scripts/b.ts', 'gates/new.ts']);
    expect(changedPaths('', '')).toEqual([]);
  });
});

describe('timeoutArgs — Stryker timeouts from the configured file, never hard-coded', () => {
  it('passes the configured timeoutMS and timeoutFactor to onkel', () => {
    expect(timeoutArgs('{"stryker":{"timeoutMS":8000,"timeoutFactor":2}}')).toEqual(['--timeout-ms', '8000', '--timeout-factor', '2']);
    expect(timeoutArgs('{"stryker":{"timeoutFactor":2}}')).toEqual(['--timeout-factor', '2']);
    expect(timeoutArgs('{"stryker":{"dryRunTimeoutMinutes":20}}')).toEqual(['--dry-run-timeout-minutes', '20']);
  });

  it("leaves Stryker's defaults with no config, or one without the values", () => {
    expect(timeoutArgs(undefined)).toEqual([]);
    expect(timeoutArgs('{}')).toEqual([]);
    expect(timeoutArgs('not json')).toEqual([]);
  });
});

describe('slowestTestFiles — from vitest JSON reporter', () => {
  const ROOT = '/repo';
  const result = (name: string, startTime: number, endTime: number) => ({ name, startTime, endTime });

  it('lists the ten slowest test files, slowest first, by repo path and ms', () => {
    const files = Array.from({ length: 12 }, (_, i) => result(`/repo/scripts/t${i}.test.ts`, 1000, 1000 + i * 10));
    expect(slowestTestFiles(JSON.stringify({ testResults: files }), ROOT)).toEqual(
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((i) => ({ file: `scripts/t${i}.test.ts`, ms: i * 10 })),
    );
  });

  it('reads Windows paths with either slash', () => {
    const json = JSON.stringify({ testResults: [result('C:/w/repo/a.test.ts', 0, 5), result('C:\\w\\repo\\b.test.ts', 0, 7)] });
    expect(slowestTestFiles(json, 'C:\\w\\repo')).toEqual([
      { file: 'b.test.ts', ms: 7 },
      { file: 'a.test.ts', ms: 5 },
    ]);
  });

  it('is none without a report, or with one it cannot read', () => {
    expect(slowestTestFiles(undefined, ROOT)).toEqual([]);
    expect(slowestTestFiles('{', ROOT)).toEqual([]);
    expect(slowestTestFiles('{}', ROOT)).toEqual([]);
    expect(slowestTestFiles('{"testResults":[{"name":"/repo/a.test.ts"}]}', ROOT)).toEqual([]);
  });
});

describe('slowLines', () => {
  it('prints each slow file with its seconds', () => {
    expect(slowLines([{ file: 'a.test.ts', ms: 12_345 }])).toEqual(['Slowest test files:', '  12.3 s  a.test.ts']);
    expect(slowLines([])).toEqual([]);
  });
});

describe('stageObservations — one gate observation per stage, so the evaluation sees gate cost', () => {
  const base = { at: 'T', run: 'r', project: 'workflow', ticket: '31', role: 'coder' };
  const slowest = [{ file: 'a.test.ts', ms: 9 }];

  it('records each stage as gate self-gate-<stage> with its verdict and ms; the unit stage carries the slowest test files', () => {
    const results = [
      { id: 'typecheck' as const, status: 0 as const, ms: 10 },
      { id: 'unit' as const, status: 1 as const, ms: 20 },
      { id: 'onkel' as const, status: 2 as const, ms: 30 },
    ];
    expect(stageObservations(base, 'abc', results, slowest)).toEqual([
      { ...base, kind: 'gate', gate: 'self-gate-typecheck', sha: 'abc', verdict: 'pass', reasons: [], ms: 10 },
      { ...base, kind: 'gate', gate: 'self-gate-unit', sha: 'abc', verdict: 'fail', reasons: [], ms: 20, slowest },
      { ...base, kind: 'gate', gate: 'self-gate-onkel', sha: 'abc', verdict: 'could-not-run', reasons: [], ms: 30 },
    ]);
  });
});
