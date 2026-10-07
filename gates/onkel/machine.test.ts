import { describe, expect, it } from 'vitest';
import { machineReport, timeoutLine, timeoutOptions, timeoutWait } from './machine.ts';
import type { MutantReport } from './policy.ts';

const mutant = (status: string, line = 1, ignoreReason?: string): MutantReport => ({ file: 'src/a.ts', line, mutator: 'ConditionalExpression', status, ignoreReason });

describe('timeoutOptions — Stryker timeouts from config, never hard-coded (ticket 31)', () => {
  it('passes the configured values on as numbers', () => {
    expect(timeoutOptions('9000', '2.5')).toEqual({ timeoutMS: 9000, timeoutFactor: 2.5 });
  });

  it("leaves an unset value to Stryker's own default", () => {
    // Strict: a key set to undefined would still reach Stryker's config.
    expect(timeoutOptions(undefined, undefined)).toStrictEqual({});
    expect(timeoutOptions('100', undefined)).toStrictEqual({ timeoutMS: 100 });
    expect(timeoutOptions(undefined, '3')).toStrictEqual({ timeoutFactor: 3 });
  });

  it('refuses a value that is not a positive number, so a typo cannot pass as a default', () => {
    expect(() => timeoutOptions('abc', undefined)).toThrow('--timeout-ms must be a positive number, not "abc"');
    expect(() => timeoutOptions(undefined, '0')).toThrow('--timeout-factor must be a positive number, not "0"');
    expect(() => timeoutOptions('-1', undefined)).toThrow('--timeout-ms');
    expect(() => timeoutOptions('', undefined)).toThrow('--timeout-ms');
  });
});

describe('timeoutWait — what the timed-out mutants cost', () => {
  const LOG = 'INFO DryRunExecutor Initial test run succeeded. Ran 40 tests in 3 seconds (net 2000 ms, overhead 400 ms).';

  it("counts the timeouts and their wait from the dry run's net and overhead times: factor x net + ms + overhead each", () => {
    expect(timeoutWait([mutant('Timeout'), mutant('Killed'), mutant('Timeout')], LOG, { timeoutMS: 1000, timeoutFactor: 2 })).toEqual({ count: 2, waitMs: 2 * (2 * 2000 + 1000 + 400) });
  });

  it("uses Stryker's defaults (5000 ms, factor 1.5) when none were configured", () => {
    expect(timeoutWait([mutant('Timeout')], LOG, {})).toEqual({ count: 1, waitMs: 1.5 * 2000 + 5000 + 400 });
  });

  it('counts only timeoutMS when the log does not say what the dry run took', () => {
    expect(timeoutWait([mutant('Timeout')], 'no dry run here', { timeoutMS: 700 })).toEqual({ count: 1, waitMs: 700 });
  });

  it('is nothing without a timeout', () => {
    expect(timeoutWait([mutant('Killed')], LOG, {})).toEqual({ count: 0, waitMs: 0 });
  });
});

describe('timeoutLine', () => {
  it('says how many mutants timed out and their total wait, in seconds', () => {
    expect(timeoutLine({ count: 3, waitMs: 12_345 })).toBe('Stryker timeouts: 3 mutant(s) timed out, waiting at most 12.3 s in all');
  });
});

describe('machineReport — the run as data, for the self-gate summary and the cloud gate report', () => {
  const crap = [
    { name: 'f', file: 'src/a.ts', startLine: 1, endLine: 3, complexity: 2, coverage: 1, crap: 2 },
    { name: 'g', file: 'src/a.ts', startLine: 5, endLine: 9, complexity: 3, coverage: 0.5, crap: 4.5 },
  ];

  it('counts kills over every mutant that was not suppressed, and lists survivors and suppressions', () => {
    const mutants = [mutant('Killed', 1), mutant('Timeout', 2), mutant('CompileError', 3), mutant('Survived', 4), mutant('NoCoverage', 5), mutant('Ignored', 6, 'equivalent')];
    expect(machineReport(['src/a.ts'], crap, mutants, { verdict: 'escalate', failures: [], suppressed: 1 }, { count: 1, waitMs: 10 })).toEqual({
      verdict: 'escalate',
      files: ['src/a.ts'],
      mutants: { killed: 3, total: 5 },
      survivors: [
        { file: 'src/a.ts', line: 4, mutator: 'ConditionalExpression', status: 'Survived' },
        { file: 'src/a.ts', line: 5, mutator: 'ConditionalExpression', status: 'NoCoverage' },
      ],
      suppressions: [{ file: 'src/a.ts', line: 6, mutator: 'ConditionalExpression', reason: 'equivalent' }],
      timeouts: { count: 1, waitMs: 10 },
      highestCrap: 4.5,
      overCeiling: [],
      mutationSkipped: false,
    });
  });

  it('reads an empty run as no mutants and a highest CRAP of 0, and says when mutation was skipped', () => {
    expect(machineReport([], [], [], { verdict: 'pass', failures: [], suppressed: 0, mutationSkipped: true }, { count: 0, waitMs: 0 })).toEqual({
      verdict: 'pass',
      files: [],
      mutants: { killed: 0, total: 0 },
      survivors: [],
      suppressions: [],
      timeouts: { count: 0, waitMs: 0 },
      highestCrap: 0,
      overCeiling: [],
      mutationSkipped: true,
    });
  });

  // Ticket 39: the controller tells a complexity failure from a coverage one by these two numbers.
  it('lists each function over the CRAP ceiling with its complexity and coverage, and none at the ceiling', () => {
    const scores = [
      { name: 'checkField', file: 'src/view.ts', startLine: 12, endLine: 40, complexity: 11, coverage: 1, crap: 11 },
      { name: 'atCeiling', file: 'src/view.ts', startLine: 42, endLine: 50, complexity: 6, coverage: 1, crap: 6 },
      { name: 'untested', file: 'src/view.ts', startLine: 52, endLine: 60, complexity: 4, coverage: 0.2, crap: 12.192 },
    ];
    expect(machineReport(['src/view.ts'], scores, [], { verdict: 'escalate', failures: [], suppressed: 0, mutationSkipped: true }, { count: 0, waitMs: 0 }).overCeiling).toEqual([
      { name: 'checkField', file: 'src/view.ts', startLine: 12, endLine: 40, complexity: 11, coverage: 1, crap: 11 },
      { name: 'untested', file: 'src/view.ts', startLine: 52, endLine: 60, complexity: 4, coverage: 0.2, crap: 12.192 },
    ]);
  });

  it('gives a suppression with no reason an empty one', () => {
    expect(machineReport([], [], [mutant('Ignored', 2)], { verdict: 'escalate', failures: [], suppressed: 0 }, { count: 0, waitMs: 0 }).suppressions).toEqual([
      { file: 'src/a.ts', line: 2, mutator: 'ConditionalExpression', reason: '' },
    ]);
  });
});
