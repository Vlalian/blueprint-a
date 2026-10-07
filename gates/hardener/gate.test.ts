import { describe, expect, it } from 'vitest';
import { gradedSources, hardenerGate, type HardenerIo } from './gate.ts';

function io(over: Partial<HardenerIo> = {}) {
  const calls: string[][] = [];
  const logs: string[] = [];
  const base: HardenerIo = {
    diffNames: () => 'src/clamp.ts\ntests/protected/clamp.test.ts\n',
    untracked: () => 'tests/hardener/clamp.test.ts\nsrc/new.ts\n',
    onkel: (args) => {
      calls.push(args);
      return 0;
    },
    log: (line) => logs.push(line),
  };
  return { io: { ...base, ...over }, calls, logs };
}

describe('gradedSources', () => {
  it('keeps changed TypeScript sources and drops tests, declarations and anything else', () => {
    expect(
      gradedSources([
        'src/clamp.ts',
        'src/clamp.test.ts',
        'tests/hardener/clamp.property.test.ts',
        'src/types.d.ts',
        'src/view.tsx',
        'README.md',
        'node_modules/x/index.ts',
        '',
      ]),
    ).toEqual(['src/clamp.ts']);
  });
});

describe('hardenerGate', () => {
  it('runs onkel on every source file changed since base, untracked ones included', () => {
    const { io: i, calls } = io();
    expect(hardenerGate({ base: 'main' }, i)).toBe(0);
    expect(calls).toEqual([['--base', 'main', 'src/clamp.ts', 'src/new.ts']]);
  });

  it("asks onkel for its result as data where a cloud role's gate says (ticket 32, $WORKFLOW_GATE_JSON)", () => {
    const { io: i, calls } = io();
    hardenerGate({ base: 'main', json: 'tmp/0.json' }, i);
    expect(calls).toEqual([['--base', 'main', '--json', 'tmp/0.json', 'src/clamp.ts', 'src/new.ts']]);
    const empty = io();
    hardenerGate({ base: 'main', json: '' }, empty.io);
    expect(empty.calls).toEqual([['--base', 'main', 'src/clamp.ts', 'src/new.ts']]);
  });

  it("passes on onkel's verdict: a surviving mutant fails the hardener", () => {
    expect(hardenerGate({ base: 'main' }, io({ onkel: () => 1 }).io)).toBe(1);
  });

  it('tells the hardener, when onkel escalates, how to escalate a mutant no test can kill: the simplifying edit first', () => {
    const { io: i, logs } = io({ onkel: () => 1 });
    hardenerGate({ base: 'main' }, i);
    expect(logs).toEqual([
      [
        'hardener: a mutant no test can kill (equivalent) is not yours to suppress. End with the exact edit that removes it,',
        '  SIMPLIFY <the mutant file>:<its line> / before: <the line as it is> / after: <the line simplified> / why: <why no caller can tell>,',
        '  for the cleaner to apply; only when no simpler code exists, SUPPRESS <file>:<line> <Mutator> with the',
        '  line-level comment and its reason. See skills/hardener/SKILL.md, rule 7.',
      ].join('\n'),
    ]);
  });

  it('adds nothing to a pass, or to an onkel that could not run', () => {
    for (const status of [0, 2, null]) {
      const { io: i, logs } = io({ onkel: () => status });
      hardenerGate({ base: 'main' }, i);
      expect(logs).toEqual([]);
    }
  });

  it('reads an onkel killed by a signal as a gate that could not run', () => {
    expect(hardenerGate({ base: 'main' }, io({ onkel: () => null }).io)).toBe(2);
  });

  it('passes without running onkel when no source file changed', () => {
    const { io: i, calls, logs } = io({ diffNames: () => 'tests/a.test.ts\n', untracked: () => '' });
    expect(hardenerGate({ base: 'abc' }, i)).toBe(0);
    expect(calls).toEqual([]);
    expect(logs).toEqual(['hardener: no source file changed since abc; nothing for onkel to grade.']);
  });

  it('cannot run without a base', () => {
    const { io: i, calls, logs } = io();
    expect(hardenerGate({}, i)).toBe(2);
    expect(calls).toEqual([]);
    expect(logs).toEqual(['usage: node gates/hardener/cli.ts --base <ref>']);
  });
});

describe('hardenerGate on this repo (--self, ticket 41)', () => {
  const self = { flags: ['--exempt', 'scripts/x.ts', '--timeout-ms', '7000'], graded: (files: string[]) => files.filter((f) => f.startsWith('src/new')) };

  it("grades as the self-gate does: its onkel flags, on the files it grades", () => {
    const { io: i, calls } = io({ self });
    expect(hardenerGate({ base: 'main', json: 'tmp/0.json' }, i)).toBe(0);
    expect(calls).toEqual([['--base', 'main', '--json', 'tmp/0.json', '--exempt', 'scripts/x.ts', '--timeout-ms', '7000', 'src/new.ts']]);
  });

  it('passes without onkel when the self-gate grades none of the changed files', () => {
    const { io: i, calls, logs } = io({ self: { ...self, graded: () => [] } });
    expect(hardenerGate({ base: 'main' }, i)).toBe(0);
    expect(calls).toEqual([]);
    expect(logs).toEqual(['hardener: no source file changed since main; nothing for onkel to grade.']);
  });
});
