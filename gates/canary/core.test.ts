import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bitesTests, canaryDue, canaryNote, canaryStates, childEnv, DEFAULT_DIRS, judgeFile, runCanary, sourceDirs, sourceFiles, vitestArgs, type CanaryIo } from './core.ts';
import type { CanaryRecord } from './io.ts';

const line = (r: Record<string, unknown>) => JSON.stringify(r);
const BIT = { clean: 0, injected: 1, reverted: 0 };

describe('bitesTests: every prove-it-bites test and the gate it proves', () => {
  it('names the gate after its folder, runs integration tests with the integration config, and sorts by path', () => {
    const files = [
      'gates/red-check/bites.integration.test.ts',
      'gates/four-checks/bites.test.ts',
      'gates/four-checks/check.test.ts',
      'gates/lib/scanners.bites.test.ts',
      'adapters/claude-code/stop.bites.test.ts',
      'gates/onkel/bites.ts',
      'gates/onkel/nobites.test.ts',
      'gates/onkel/bites.test.ts.orig',
    ];
    expect(bitesTests(files)).toEqual([
      { gate: 'stop', file: 'adapters/claude-code/stop.bites.test.ts', integration: false },
      { gate: 'four-checks', file: 'gates/four-checks/bites.test.ts', integration: false },
      { gate: 'lib', file: 'gates/lib/scanners.bites.test.ts', integration: false },
      { gate: 'red-check', file: 'gates/red-check/bites.integration.test.ts', integration: true },
    ]);
  });
});

describe('judgeFile: one gate per bites check the test reported, or per file when it reported none', () => {
  const test = { gate: 'four-checks', file: 'gates/four-checks/bites.test.ts', integration: false };

  it('is green when the gate passed clean input, failed the injected fault and passed again after the revert', () => {
    expect(judgeFile(test, { status: 0, report: `${line(BIT)}\n` })).toEqual([{ gate: 'four-checks', file: test.file, state: 'green', detail: 'clean 0, injected 1, reverted 0' }]);
  });

  it('Pass when: is red when the injected fault no longer fails', () => {
    expect(judgeFile(test, { status: 1, report: line({ clean: 0, injected: 0, reverted: 0 }) })).toEqual([
      { gate: 'four-checks', file: test.file, state: 'red', detail: 'the injected fault no longer fails: clean 0, injected 0, reverted 0' },
    ]);
  });

  it('is red when clean input or the revert fails', () => {
    expect(judgeFile(test, { status: 1, report: line({ clean: 1, injected: 1, reverted: 0 }) })[0]).toMatchObject({ state: 'red', detail: 'clean input fails: clean 1, injected 1, reverted 0' });
    expect(judgeFile(test, { status: 1, report: line({ clean: 0, injected: 1, reverted: 2 }) })[0]).toMatchObject({ state: 'red', detail: 'clean input fails: clean 0, injected 1, reverted 2' });
  });

  it('is red when every check bit but the test file failed anyway', () => {
    expect(judgeFile(test, { status: 1, report: line(BIT) })[0]).toMatchObject({ state: 'red', detail: 'the bites test failed (exit 1)' });
  });

  it('could not run when vitest did not finish, whatever the report says', () => {
    expect(judgeFile(test, { status: null, report: line(BIT) })[0]).toMatchObject({ state: 'could-not-run', detail: 'the bites test could not run (exit none)' });
    expect(judgeFile(test, { status: 2, report: undefined })[0]).toMatchObject({ state: 'could-not-run', detail: 'the bites test could not run (exit 2)' });
  });

  it('judges a test that reports no checks by its exit code alone', () => {
    expect(judgeFile(test, { status: 0, report: undefined })).toEqual([{ gate: 'four-checks', file: test.file, state: 'green', detail: 'the bites test passed' }]);
    expect(judgeFile(test, { status: 1, report: '' })[0]).toMatchObject({ state: 'red', detail: 'the bites test failed (exit 1)' });
  });

  it('gives each gate a test file names its own row, worst check first, and skips lines that are not checks', () => {
    const report = [line({ gate: 'secret-scan', ...BIT }), 'not json', line({ gate: 'hidden-unicode', ...BIT }), line({ gate: 'secret-scan', clean: 0, injected: 0, reverted: 0 }), line({ clean: 0, injected: 1, reverted: 'x' }), 'null', ''].join('\n');
    expect(judgeFile({ ...test, gate: 'lib' }, { status: 1, report })).toEqual([
      { gate: 'secret-scan', file: test.file, state: 'red', detail: 'the injected fault no longer fails: clean 0, injected 0, reverted 0' },
      { gate: 'hidden-unicode', file: test.file, state: 'red', detail: 'the bites test failed (exit 1)' },
    ]);
  });
});

function memory(files: string[], runs: Record<string, { status: number | null; report?: string }>) {
  const appended: [string, string][] = [];
  const ran: [string, boolean][] = [];
  const io: CanaryIo = {
    files: () => files,
    runTest: (file, integration) => (ran.push([file, integration]), { report: undefined, ...runs[file] }),
    now: () => '2026-10-04T12:00:00.000Z',
    append: (path, text) => void appended.push([path, text]),
  };
  return { io, appended, ran };
}

describe('runCanary: every gate bites, or the canary says which does not', () => {
  const files = ['gates/a/bites.test.ts', 'gates/b/bites.integration.test.ts'];

  it('passes when every gate bites, and logs one canary record per gate', () => {
    const w = memory(files, { [files[0]]: { status: 0, report: line(BIT) }, [files[1]]: { status: 0 } });
    expect(runCanary('/s', w.io)).toEqual({
      gate: 'canary',
      pass: true,
      gates: [
        { gate: 'a', file: files[0], state: 'green', detail: 'clean 0, injected 1, reverted 0' },
        { gate: 'b', file: files[1], state: 'green', detail: 'the bites test passed' },
      ],
    });
    expect(w.ran).toEqual([
      [files[0], false],
      [files[1], true],
    ]);
    const base = { at: '2026-10-04T12:00:00.000Z', run: 'canary-2026-10-04T12:00:00.000Z', project: '', ticket: '', role: 'canary' };
    expect(w.appended).toEqual([
      [
        '/s/logs/observations.jsonl',
        `${line({ ...base, kind: 'canary', gate: 'a', state: 'green', detail: 'clean 0, injected 1, reverted 0' })}\n${line({ ...base, kind: 'canary', gate: 'b', state: 'green', detail: 'the bites test passed' })}\n`,
      ],
    ]);
  });

  it('Pass when: fails when a gate no longer bites', () => {
    const w = memory(files, { [files[0]]: { status: 1, report: line({ ...BIT, injected: 0 }) }, [files[1]]: { status: null } });
    const result = runCanary(undefined, w.io);
    expect(result).toMatchObject({ gate: 'canary', pass: false });
    expect(result).not.toHaveProperty('error');
    expect(w.appended).toEqual([]);
  });

  it('could not run when a gate could not be checked and none is red', () => {
    const w = memory(files, { [files[0]]: { status: 0 }, [files[1]]: { status: 3 } });
    expect(runCanary(undefined, w.io)).toMatchObject({ gate: 'canary', pass: false, error: 'the canary could not check b' });
    const both = memory(files, { [files[0]]: { status: 2 }, [files[1]]: { status: 3 } });
    expect(runCanary(undefined, both.io)).toMatchObject({ error: 'the canary could not check a, b' });
  });

  it('could not run when there is no prove-it-bites test at all', () => {
    expect(runCanary(undefined, memory([], {}).io)).toEqual({ gate: 'canary', pass: false, gates: [], error: 'no prove-it-bites test found' });
  });
});

const canary = (at: string, gate: string, state: string, detail = 'd') => ({ at, run: 'c', project: '', ticket: '', role: 'canary', kind: 'canary', gate, state, detail }) as CanaryRecord;

describe('canaryDue', () => {
  const now = '2026-10-08T12:00:00.000Z';

  it('is due before the first canary run and once the cadence has passed since the last one', () => {
    expect(canaryDue([], now, 7)).toBe(true);
    expect(canaryDue([canary('2026-10-01T12:00:00.000Z', 'a', 'green')], now, 7)).toBe(true);
    expect(canaryDue([canary('2026-10-01T12:00:00.001Z', 'a', 'green')], now, 7)).toBe(false);
    expect(canaryDue([canary('2026-09-01T00:00:00.000Z', 'a', 'green'), canary('2026-10-05T00:00:00.000Z', 'b', 'green')], now, 7)).toBe(false);
  });

  it('ignores every other kind of record', () => {
    const gate = { at: '2026-10-08T00:00:00.000Z', run: 'r', project: '', ticket: '', role: '', kind: 'retry', reason: '' };
    expect(canaryDue([gate], now, 7)).toBe(true);
  });
});

describe('canaryStates: the latest canary state per gate', () => {
  it('keeps the last record of each gate, sorted by gate', () => {
    const records = [canary('t1', 'b', 'red', 'old'), canary('t1', 'a', 'green'), canary('t2', 'b', 'green', 'new')];
    expect(canaryStates(records)).toEqual([
      { gate: 'a', state: 'green', detail: 'd', at: 't1' },
      { gate: 'b', state: 'green', detail: 'new', at: 't2' },
    ]);
  });
});

describe('childEnv', () => {
  it("drops this process's vitest settings so the nested vitest runs as a plain run, and adds the report path", () => {
    expect(childEnv({ PATH: '/bin', VITEST: 'true', VITEST_WORKER_ID: '1', NODE_ENV: 'test', TEST: 'true', HOME: '/h', MY_TEST: 'k', TESTING: 'k' }, '/r.jsonl')).toEqual({
      PATH: '/bin',
      HOME: '/h',
      MY_TEST: 'k',
      TESTING: 'k',
      WORKFLOW_CANARY_REPORT: '/r.jsonl',
    });
  });
});

describe('vitestArgs', () => {
  it('runs one test file with the unit or the integration config of the folder it runs in', () => {
    expect(vitestArgs('/w', 'gates/a/bites.test.ts', false)).toEqual(['run', '--config', join('/w', 'vitest.config.ts'), 'gates/a/bites.test.ts']);
    expect(vitestArgs('/w', 'gates/b/bites.integration.test.ts', true)).toEqual(['run', '--config', join('/w', 'vitest.integration.config.ts'), 'gates/b/bites.integration.test.ts']);
  });
});

describe('sourceFiles', () => {
  it("prefixes each file found under a source folder with the folder, '/'-separated, Windows separators too", () => {
    expect(sourceFiles('gates', ['a', join('a', 'bites.test.ts'), 'b\\c.ts'])).toEqual(['gates/a', 'gates/a/bites.test.ts', 'gates/b/c.ts']);
  });

});

describe('sourceDirs: the folders a prove-it-bites test may live in', () => {
  it("are config/canary.json's dirs", () => {
    expect(sourceDirs('{ "dirs": ["gates", "tools"] }')).toEqual(['gates', 'tools']);
    expect(sourceDirs('{ "dirs": [] }')).toEqual([]);
  });

  it('are gates and adapters without the file', () => {
    expect(sourceDirs(undefined)).toBe(DEFAULT_DIRS);
    expect(DEFAULT_DIRS).toEqual(['gates', 'adapters']);
  });

  it('throw, so the canary could not run, when the file names no list of folders', () => {
    for (const bad of ['{}', '{ "dirs": "gates" }', '{ "dirs": ["gates", 1] }', 'null']) expect(() => sourceDirs(bad)).toThrow('config/canary.json: "dirs" must be a list of folder names');
    expect(() => sourceDirs('{')).toThrow();
  });
});

describe('canaryNote', () => {
  it('says in one line what the canary found, by its exit code', () => {
    expect([0, 1, 2, null].map(canaryNote)).toEqual([
      'Canary: every gate still bites.',
      'Canary: a gate no longer bites; see Needs you.',
      'Canary: it could not check every gate; see Needs you.',
      'Canary: it could not check every gate; see Needs you.',
    ]);
  });
});
