import { beforeEach, describe, expect, it, vi } from 'vitest';
import { report, reportSuppressions } from './report.ts';

/**
 * What a human is told, and the exit code that goes with it. Moved out of cli.ts, which is
 * exempt from mutation, so these decisions are mutation-tested as the header always said (review #22).
 */

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('report — what a human is actually told', () => {
  const scored = (over = {}) => ({
    name: 'f',
    file: 'src/a.ts',
    startLine: 3,
    endLine: 9,
    complexity: 4,
    coverage: 0.5,
    crap: 8,
    ...over,
  });

  function output(fn: () => number): { text: string; code: number } {
    // beforeEach already spies on console.log, so the same spy carries
    // calls from earlier tests unless it is cleared here.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.mockClear();
    const code = fn();
    return { text: log.mock.calls.flat().join('\n'), code };
  }

  it('says PASS and exits 0 when the verdict passes', () => {
    const { text, code } = output(() =>
      report([], [], [], { verdict: 'pass', failures: [], suppressed: 0 }),
    );

    expect(code).toBe(0);
    expect(text).toContain('PASS');
    expect(text).not.toContain('ESCALATE');
  });

  it('says ESCALATE, counts the problems, and exits 1', () => {
    const { text, code } = output(() =>
      report([], [], [], {
        verdict: 'escalate',
        failures: [
          {
            kind: 'crap',
            name: 'big',
            file: 'src/a.ts',
            line: 3,
            detail: 'CRAP 8.0 exceeds the ceiling of 6',
          },
        ],
        suppressed: 0,
      }),
    );

    expect(code).toBe(1);
    expect(text).toContain('ESCALATE — 1 problem(s)');
    expect(text).toContain('[crap] src/a.ts:3 big — CRAP 8.0 exceeds the ceiling of 6');
  });

  it('says mutation was skipped because CRAP failed first, instead of a mutant count (decision #40)', () => {
    const { text, code } = output(() =>
      report([scored()], [], [], {
        verdict: 'escalate',
        failures: [{ kind: 'crap', name: 'f', file: 'src/a.ts', line: 3, detail: 'CRAP 8.0 exceeds the ceiling of 6' }],
        suppressed: 0,
        mutationSkipped: true,
      }),
    );

    expect(code).toBe(1);
    expect(text).toContain('\nmutation skipped: CRAP failed first');
    expect(text).not.toContain('Mutants:');
  });

  it('counts mutants as usual when mutation ran', () => {
    const { text } = output(() => report([], [], [], { verdict: 'pass', failures: [], suppressed: 0, mutationSkipped: false }));

    expect(text).toContain('Mutants: 0');
    expect(text).not.toContain('mutation skipped');
  });

  it('tells the reader not to relax the gate, which is the point of the tool', () => {
    // The one instruction that stops an agent "fixing" an escalation by
    // widening the exclusions.
    const { text } = output(() =>
      report([], [], [], { verdict: 'escalate', failures: [], suppressed: 0 }),
    );

    expect(text).toContain('Do not relax the gate');
  });

  it('names the worst functions with their complexity and coverage', () => {
    const { text } = output(() =>
      report([scored(), scored({ name: 'small', crap: 1, complexity: 1, coverage: 1 })], [], [], {
        verdict: 'pass',
        failures: [],
        suppressed: 0,
      }),
    );

    expect(text).toContain('8.0  src/a.ts:3  f  (complexity 4, coverage 50%)');
    // Worst first — a reader scanning the top of the list should see the worst.
    expect(text.indexOf('  f  ')).toBeLessThan(text.indexOf('  small  '));
  });

  it('counts the kills and the suppressions', () => {
    const m = (status: string) => ({
      file: 'src/a.ts',
      line: 1,
      mutator: 'X',
      status,
    });
    const { text } = output(() =>
      report([], [], [m('Killed'), m('Killed'), m('Ignored')], {
        verdict: 'pass',
        failures: [],
        suppressed: 1,
      }),
    );

    expect(text).toContain('Mutants: 3 — 2 killed, 1 suppressed');
  });

  it('counts kills the way the verdict does: a timeout or compile error is a kill (count mismatch fix)', () => {
    const m = (status: string) => ({ file: 'src/a.ts', line: 1, mutator: 'X', status });
    const { text } = output(() =>
      report([], [], [m('Killed'), m('Timeout'), m('CompileError'), m('Ignored')], { verdict: 'pass', failures: [], suppressed: 1 }),
    );

    expect(text).toContain('Mutants: 4 — 3 killed (1 killed, 1 timeout, 1 compile error), 1 suppressed');
  });

  // code-health/31: the count alone hides what was suppressed and why.
  const suppressed = (over = {}) => ({ file: 'src/a.ts', line: 10, mutator: 'X', commentLine: 9, reason: 'equivalent' as string | null, ...over });

  it('prints each new suppression with its reason under the verdict', () => {
    const { text } = output(() => {
      reportSuppressions({ new: [suppressed()], existing: [] });
      return 0;
    });
    expect(text).toContain('Suppressed, new in this change:');
    expect(text).toContain('  src/a.ts:10 X — equivalent');
    expect(text).not.toContain('already there');
  });

  it('prints nothing for an empty list, and "(no reason given)" for a null reason', () => {
    expect(output(() => (reportSuppressions({ new: [], existing: [] }), 0)).text).toBe('');
    const { text } = output(() => (reportSuppressions({ new: [], existing: [suppressed({ file: 'b.ts', line: 3, mutator: 'Y', reason: null })] }), 0));
    expect(text).toContain('Suppressed, already there:');
    expect(text).toContain('  b.ts:3 Y — (no reason given)');
    const empty = output(() => (reportSuppressions({ new: [], existing: [suppressed({ file: 'c.ts', line: 4, mutator: 'Z', reason: '' })] }), 0));
    expect(empty.text).toContain('  c.ts:4 Z — (no reason given)');
  });

  it('says plainly when it cannot tell new from old', () => {
    const { text } = output(() => (reportSuppressions({ unsplit: [suppressed()] }), 0));
    expect(text).toContain('Suppressed (no diff to tell new from old):');
    expect(text).toContain('  src/a.ts:10 X — equivalent');
  });

  it('lists what it left standing with its numbers, and still passes', () => {
    // GATE-SCOPE asks for both numbers, so the post-test sweep knows what it is
    // walking into: what the change cleared, and what it left and where.
    const { text, code } = output(() =>
      report([], [], [], { verdict: 'pass', failures: [], suppressed: 0 }, [
        scored({
          name: 'old',
          startLine: 40,
          crap: 12,
          complexity: 3,
          coverage: 0,
        }),
        scored({ name: 'fine', crap: 2, complexity: 2, coverage: 1 }),
      ]),
    );

    expect(code).toBe(0);
    expect(text).toContain(
      'Left standing (not this change): 2 function(s) not graded, 1 over the ceiling',
    );
    expect(text).toContain('12.0  src/a.ts:40  old  (complexity 3, coverage 0%)');
    expect(text).not.toContain('  fine  ');
  });

  it('says nothing about standing functions when the run graded whole files', () => {
    const { text } = output(() =>
      report([], [], [], { verdict: 'pass', failures: [], suppressed: 0 }),
    );

    expect(text).not.toContain('Left standing');
  });

  const cognitiveScore = (over = {}) => ({
    name: 'deep',
    file: 'src/a.ts',
    startLine: 12,
    endLine: 30,
    cognitive: 9,
    ...over,
  });

  it('prints cognitive complexity worst-first, and says it does not gate', () => {
    // The label is the load-bearing part. An agent that reads this as a target
    // will flatten nesting by hoisting bodies into helpers called once, which
    // moves the number without helping anyone.
    const { text } = output(() =>
      report(
        [],
        [cognitiveScore(), cognitiveScore({ name: 'shallow', cognitive: 2, startLine: 40 })],
        [],
        {
          verdict: 'pass',
          failures: [],
          suppressed: 0,
        },
      ),
    );

    expect(text).toContain('does not gate');
    expect(text).toContain('9  src/a.ts:12  deep');
    expect(text.indexOf('  deep')).toBeLessThan(text.indexOf('  shallow'));
  });

  it('passes a run whose cognitive scores are terrible', () => {
    // The diagnostic must not be able to change the exit code /build-afk keys
    // off — that is the difference between a diagnostic and a gate.
    const { code } = output(() =>
      report([], [cognitiveScore({ cognitive: 500 })], [], {
        verdict: 'pass',
        failures: [],
        suppressed: 0,
      }),
    );

    expect(code).toBe(0);
  });

  it('says nothing at all when there is nothing to report', () => {
    const { text } = output(() =>
      report([], [], [], { verdict: 'pass', failures: [], suppressed: 0 }),
    );

    expect(text).not.toContain('cognitive');
  });
});

describe('report — the ranked lists, exactly', () => {
  const lines = (fn: () => void): string[] => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.mockClear();
    fn();
    return log.mock.calls.flat().join('\n').split('\n');
  };
  const PASS = { verdict: 'pass' as const, failures: [], suppressed: 0 };
  const crapOf = (name: string, crap: number) => ({ name, file: 'a.ts', startLine: 1, endLine: 2, complexity: 2, coverage: 1, crap });

  it('heads the CRAP list and shows the five worst, worst first', () => {
    const scores = [3, 9, 1, 7, 5, 8, 2].map((c) => crapOf(`f${c}`, c));
    const out = lines(() => report(scores, [], [], PASS));
    expect(out[0]).toBe('Highest CRAP:');
    expect(out.slice(1, 7)).toEqual([
      '     9.0  a.ts:1  f9  (complexity 2, coverage 100%)',
      '     8.0  a.ts:1  f8  (complexity 2, coverage 100%)',
      '     7.0  a.ts:1  f7  (complexity 2, coverage 100%)',
      '     5.0  a.ts:1  f5  (complexity 2, coverage 100%)',
      '     3.0  a.ts:1  f3  (complexity 2, coverage 100%)',
      '',
    ]);
  });

  it('shows the five deepest functions, deepest first', () => {
    const cognitive = [3, 9, 1, 7, 5, 8, 2].map((c) => ({ name: `g${c}`, file: 'a.ts', startLine: c, endLine: c, cognitive: c }));
    const out = lines(() => report([], cognitive, [], PASS));
    const at = out.indexOf('Highest cognitive complexity (diagnostic — does not gate):');
    expect(out.slice(at + 1, at + 7)).toEqual([
      '       9  a.ts:9  g9',
      '       8  a.ts:8  g8',
      '       7  a.ts:7  g7',
      '       5  a.ts:5  g5',
      '       3  a.ts:3  g3',
      '',
    ]);
  });

  it('lists standing functions over the ceiling worst first, and not one at the ceiling', () => {
    const standing = [7, 6, 12, 9].map((c) => crapOf(`s${c}`, c));
    const out = lines(() => report([], [], [], PASS, standing));
    const at = out.indexOf('Left standing (not this change): 4 function(s) not graded, 3 over the ceiling — recorded, not gating.');
    expect(out.slice(at + 1, at + 5)).toEqual([
      '    12.0  a.ts:1  s12  (complexity 2, coverage 100%)',
      '     9.0  a.ts:1  s9  (complexity 2, coverage 100%)',
      '     7.0  a.ts:1  s7  (complexity 2, coverage 100%)',
      '',
    ]);
  });

  it('prints no suppression heading when it is given no suppressions', () => {
    expect(lines(() => report([], [], [], PASS)).filter((l) => l.startsWith('Suppressed'))).toEqual([]);
  });
});
