import { describe, it, expect } from 'vitest';
import { judge, killCount, skipsMutation, CRAP_CEILING, type CrapScore, type MutantReport } from './policy.ts';

/**
 * Mode A's gates, which are absolute rather than a ratchet.
 *
 * The reasoning is in `.scratch/onkel/PLAN.md`: you are grading code you just
 * wrote against a standard you knew before writing it. There is no legacy to
 * be fair to, and "not worse than yesterday" means nothing for a function that
 * did not exist yesterday.
 *
 * The verdict is computed from recorded numbers and the agent obeys it. An
 * agent that judges its own convergence has a cheap way to declare victory.
 */

function crap(over: Partial<CrapScore> = {}): CrapScore {
  return { name: 'f', file: 'a.ts', startLine: 1, endLine: 5, crap: 3, ...over };
}

function mutant(over: Partial<MutantReport> = {}): MutantReport {
  return { file: 'a.ts', line: 3, mutator: 'ConditionalExpression', status: 'Killed', ...over };
}

describe('judge — CRAP', () => {
  it('passes a function at the ceiling', () => {
    expect(judge({ crap: [crap({ crap: CRAP_CEILING })], mutants: [] }).verdict).toBe('pass');
  });

  it('fails a function one over the ceiling, and says by how much', () => {
    // The message is the whole output of this tool to a human — an agent that
    // reads "escalate" and no number has to go and re-derive it.
    const result = judge({
      crap: [crap({ name: 'tooMuch', file: 'b.ts', startLine: 9, crap: CRAP_CEILING + 1 })],
      mutants: [],
    });

    expect(result.verdict).toBe('escalate');
    expect(result.failures[0]).toEqual({
      kind: 'crap',
      name: 'tooMuch',
      file: 'b.ts',
      line: 9,
      detail: 'CRAP 7.0 exceeds the ceiling of 6',
    });
  });

  it('reports every function over the ceiling, not just the first', () => {
    const result = judge({
      crap: [crap({ name: 'a', crap: 9 }), crap({ name: 'b', crap: 3 }), crap({ name: 'c', crap: 7 })],
      mutants: [],
    });

    expect(result.failures.map((f) => f.name)).toEqual(['a', 'c']);
  });
});

describe('judge — mutation', () => {
  it('passes when every mutant died', () => {
    expect(judge({ crap: [], mutants: [mutant(), mutant()] }).verdict).toBe('pass');
  });

  it('fails on a survivor, and names where it lived', () => {
    const result = judge({
      crap: [],
      mutants: [mutant(), mutant({ status: 'Survived', line: 42, mutator: 'BooleanLiteral' })],
    });

    expect(result.verdict).toBe('escalate');
    expect(result.failures[0]).toEqual({
      kind: 'mutant',
      name: 'BooleanLiteral',
      file: 'a.ts',
      line: 42,
      mutator: 'BooleanLiteral',
      detail: 'survived',
    });
  });

  it('fails on a mutant no test even reached', () => {
    // NoCoverage is a survivor that did not have to try. Treating it as
    // anything softer would make untested code the cheapest way past the gate.
    const result = judge({ crap: [], mutants: [mutant({ status: 'NoCoverage' })] });

    expect(result.verdict).toBe('escalate');
    // Said differently from a survivor on purpose: one was tested and got
    // away, the other was never tested at all, and they need different fixes.
    expect(result.failures[0]).toMatchObject({
      kind: 'mutant',
      detail: 'no test reaches this',
    });
  });

  it.each(['Timeout', 'CompileError'])('does not call a %s a survivor', (status) => {
    // A Timeout is a kill — the mutant hung and the tests noticed. A
    // CompileError never ran and says nothing about the tests, which is why
    // Stryker leaves it out of the score too. Reporting either as a survivor
    // would send an agent hunting for a test that would not have helped.
    expect(judge({ crap: [], mutants: [mutant(), mutant({ status })] }).verdict).toBe('pass');
  });

  it('escalates as inconclusive a run whose only kills are timeouts: no test killed anything (decision #41)', () => {
    // A hung mutant says the tests noticed something, not that any assertion did. A run in which
    // every kill is a timeout has no evidence a test can tell the code from its mutants.
    const result = judge({ crap: [], mutants: [mutant({ status: 'Timeout' }), mutant({ status: 'Timeout', line: 9 })] });

    expect(result.verdict).toBe('escalate');
    expect(result.failures).toEqual([
      {
        kind: 'inconclusive',
        name: '(run)',
        file: '(all)',
        line: 0,
        mutator: '(none)',
        detail: 'no mutant was killed by a test; 2 timed out — the run proves nothing about the tests',
      },
    ]);
  });

  it('escalates the timeout-only run even beside compile errors and suppressions', () => {
    const mutants = [
      mutant({ status: 'Timeout' }),
      mutant({ status: 'CompileError' }),
      mutant({ status: 'Ignored', ignoreReason: 'equivalent' }),
    ];
    expect(judge({ crap: [], mutants }).failures.map((f) => f.kind)).toEqual(['inconclusive']);
  });

  it('passes a run with one test kill beside its timeouts', () => {
    expect(judge({ crap: [], mutants: [mutant({ status: 'Timeout' }), mutant()] }).verdict).toBe('pass');
  });

  it('passes a run whose only mutants are compile errors: none ran, and none timed out', () => {
    expect(judge({ crap: [], mutants: [mutant({ status: 'CompileError' })] }).verdict).toBe('pass');
  });

  it.each(['RuntimeError', 'Pending'])('refuses to pass an unsettled %s mutant', (status) => {
    // Stryker's schema has eight statuses, and these two mean nobody can say
    // whether the tests caught the mutant: `RuntimeError` broke the runner,
    // and `Pending` is what an interrupted run leaves behind. Passing on them
    // is passing on the absence of evidence, which is the one thing this gate
    // exists to refuse. (Found by CodeRabbit on PR #44; the status was a
    // closed union and the CLI force-cast into it, so both fell through
    // silently.)
    const result = judge({ crap: [], mutants: [mutant({ status })] });

    expect(result.verdict).toBe('escalate');
    expect(result.failures[0]).toMatchObject({ kind: 'inconclusive' });
  });

  it('refuses a status it has never heard of', () => {
    // The general form of the same rule: a later Stryker adding a status must
    // stop this gate, not slip through it.
    const result = judge({ crap: [], mutants: [mutant({ status: 'SomethingNew' })] });

    expect(result.verdict).toBe('escalate');
    expect(result.failures[0].detail).toContain('SomethingNew');
  });

  it('accepts a mutant suppressed with a reason', () => {
    // Equivalent mutants are real even in new code.
    const result = judge({
      crap: [],
      mutants: [mutant({ status: 'Ignored', ignoreReason: 'equivalent: both branches return 0' })],
    });

    expect(result.verdict).toBe('pass');
  });

  it('fails a mutant suppressed without a reason', () => {
    const result = judge({ crap: [], mutants: [mutant({ status: 'Ignored' })] });

    expect(result.verdict).toBe('escalate');
    expect(result.failures[0]).toMatchObject({
      kind: 'unexplained-suppression',
      detail: 'suppressed with no reason given',
    });
  });

  it('fails a mutant hidden by a broader ignore than one line, reason or not, and does not count it (decision #28)', () => {
    const result = judge({ crap: [], mutants: [mutant(), mutant({ status: 'Ignored', ignoreReason: 'generated', broad: true, line: 7 })] });

    expect(result.verdict).toBe('escalate');
    expect(result.failures).toEqual([
      {
        kind: 'broad-suppression',
        name: 'ConditionalExpression',
        file: 'a.ts',
        line: 7,
        detail: 'suppressed by an ignore broader than one line (file, block, `all` or config); only a line-level "disable next-line <mutator>: <reason>" is accepted',
      },
    ]);
    expect(result.suppressed).toBe(0);
  });

  it('treats a blank reason as no reason', () => {
    // Otherwise a space is the whole cost of suppressing a mutant.
    const result = judge({ crap: [], mutants: [mutant({ status: 'Ignored', ignoreReason: '   ' })] });

    expect(result.verdict).toBe('escalate');
    expect(result.suppressed).toBe(0);
  });

  it('counts suppressions so they cannot quietly become the way to pass', () => {
    const result = judge({
      crap: [],
      mutants: [
        mutant(),
        mutant({ status: 'Ignored', ignoreReason: 'equivalent' }),
        mutant({ status: 'Ignored', ignoreReason: 'equivalent' }),
      ],
    });

    expect(result.verdict).toBe('pass');
    expect(result.suppressed).toBe(2);
  });

  it('refuses to pass a run that produced no mutants at all', () => {
    // Nothing to kill means the run did not cover what the ticket touched —
    // an empty result reads identical to a perfect one, and it is not one.
    const result = judge({ crap: [crap()], mutants: [], ranMutation: true });

    expect(result.verdict).toBe('escalate');
    expect(result.failures[0]).toMatchObject({
      kind: 'no-mutants',
      detail: 'the mutation run produced no mutants — it did not cover the ticket',
    });
  });

  it('does not report an empty run when the run was not empty', () => {
    // The other half of the no-mutants rule: a run that produced mutants and
    // killed them all is a pass, not "no mutants".
    const result = judge({ crap: [], mutants: [mutant()], ranMutation: true });

    expect(result.verdict).toBe('pass');
    expect(result.failures).toEqual([]);
  });

  it('does not invent that failure when the run was explicitly skipped', () => {
    // `ranMutation: false` is a caller saying "I did not run it", which is not
    // the same claim as "I ran it and found nothing".
    expect(judge({ crap: [], mutants: [], ranMutation: false }).verdict).toBe('pass');
  });

  it('still reports an empty run as a failure when there was code to grade', () => {
    expect(judge({ crap: [crap()], mutants: [], ranMutation: true }).failures).toHaveLength(1);
  });

  it('escalates when Stryker mutated fewer files than it was handed, even with mutants to show (review #21)', () => {
    // Stryker found b.ts of a.ts and b.ts: b.ts's mutants all died, a.ts was never mutated.
    const result = judge({ crap: [], mutants: [mutant()], ranMutation: true, missedFiles: true });

    expect(result.verdict).toBe('escalate');
    expect(result.failures).toEqual([
      {
        kind: 'missed-files',
        name: '(files)',
        file: '(all)',
        line: 0,
        detail: 'Stryker found fewer files than it was handed — a named file was never mutated',
      },
    ]);
  });

  it('does not report missed files when Stryker found every file', () => {
    expect(judge({ crap: [], mutants: [mutant()], ranMutation: true, missedFiles: false }).verdict).toBe('pass');
  });

  it('does not invent that failure when no mutation run happened', () => {
    // `npm run quality` on a ticket with no gradable source files is a pass,
    // not an escalation.
    expect(judge({ crap: [], mutants: [] }).verdict).toBe('pass');
  });
});

describe('judge — the verdict is a whole', () => {
  it('reports both kinds of failure together rather than stopping at the first', () => {
    const result = judge({
      crap: [crap({ name: 'big', crap: 12 })],
      mutants: [mutant({ status: 'Survived' })],
    });

    expect(result.failures.map((f) => f.kind)).toEqual(['crap', 'mutant']);
  });

  it('never returns anything but pass or escalate', () => {
    // Mode A has no ratchet and no "close enough": the flow either satisfies
    // the bar or stops and asks. It must never lower its own bar.
    for (const input of [
      { crap: [], mutants: [] },
      { crap: [crap({ crap: 99 })], mutants: [] },
    ]) {
      expect(['pass', 'escalate']).toContain(judge(input).verdict);
    }
  });
});

describe('judge — suppression counting is not fooled by a stray reason', () => {
  it('does not count a killed mutant as suppressed just because it carries a reason', () => {
    const result = judge({
      crap: [],
      mutants: [mutant({ status: 'Killed', ignoreReason: 'left over from an edit' })],
    });

    expect(result.verdict).toBe('pass');
    expect(result.suppressed).toBe(0);
  });

  it('names the no-mutants failure so a reader can tell it from a real survivor', () => {
    const [failure] = judge({ crap: [], mutants: [], ranMutation: true }).failures;

    expect(failure).toMatchObject({ name: '(none)', file: '(all)', line: 0 });
  });
});

describe('killCount: one definition of a kill for the verdict and the summary', () => {
  const m = (status: string) => ({ file: 'a.ts', line: 1, mutator: 'X', status });

  it('counts Killed, Timeout and CompileError as kills, split by status', () => {
    expect(killCount([m('Killed'), m('Timeout'), m('CompileError'), m('Survived'), m('Ignored')])).toEqual({
      total: 3,
      killed: 1,
      timeout: 1,
      compileError: 1,
    });
  });

  it('counts nothing else as a kill', () => {
    expect(killCount([m('Survived'), m('NoCoverage'), m('Pending'), m('RuntimeError')]).total).toBe(0);
  });
});

describe('untested files (found by the real-Stryker bites test)', () => {
  it('escalates a file no test runs, naming it, even when nothing else failed', () => {
    const v = judge({ crap: [], mutants: [], untested: ['src/grade.ts'] });
    expect(v.verdict).toBe('escalate');
    // The whole file is the subject, so it is named as one and pointed at from its first line.
    expect(v.failures).toEqual([
      { kind: 'untested', name: '(file)', file: 'src/grade.ts', line: 1, detail: 'no test runs this file; write tests first' },
    ]);
  });

  it('does not also report no-mutants for a run that stopped because nothing was tested', () => {
    const v = judge({ crap: [], mutants: [], untested: ['src/grade.ts'], ranMutation: true });
    expect(v.failures.map((f) => f.kind)).toEqual(['untested']);
  });
});

describe('mutation is skipped when CRAP already fails (decision #40)', () => {
  it('skips mutation when a graded function is over the ceiling', () => {
    expect(skipsMutation([crap({ crap: CRAP_CEILING }), crap({ crap: CRAP_CEILING + 1 })])).toBe(true);
  });

  it('runs mutation when every function is at or under the ceiling, or there is none', () => {
    expect(skipsMutation([crap({ crap: CRAP_CEILING })])).toBe(false);
    expect(skipsMutation([])).toBe(false);
  });

  it('reports only the CRAP failure for a skipped run, not the empty run that skipping left', () => {
    const result = judge({
      crap: [crap({ crap: 9 })],
      mutants: [],
      ranMutation: true,
      missedFiles: true,
      untested: ['a.ts'],
      mutationSkipped: true,
    });

    expect(result.failures.map((f) => f.kind)).toEqual(['crap']);
    expect(result.mutationSkipped).toBe(true);
  });

  it('says a run that mutated was not skipped', () => {
    expect(judge({ crap: [], mutants: [mutant()] }).mutationSkipped).toBe(false);
  });
});
