import { describe, expect, it } from 'vitest';
import { sastObservations } from './sast-records.ts';

const base = { at: 't', run: 'r', project: 'p', ticket: '60', role: 'coder' };
const f = { rule: 'javascript.lang.security.detect-child-process', severity: 'ERROR', file: 'src/a.ts', line: 4, message: ' Detected  calls\nto child_process ' };

describe('sastObservations', () => {
  it('makes each blocking finding and warning a sast finding with rule, severity, file and line', () => {
    const records = sastObservations(base, 'abc', { gate: 'sast', pass: false, findings: [f], warnings: [{ ...f, severity: 'WARNING', line: 9 }] });
    expect(records).toEqual([
      { ...base, kind: 'finding', source: 'sast', id: f.rule, severity: 'ERROR', axis: 'security', file: 'src/a.ts', line: 4, summary: 'Detected calls to child_process', fate: 'blocking', reason: '', gate: 'sast', sha: 'abc' },
      { ...base, kind: 'finding', source: 'sast', id: f.rule, severity: 'WARNING', axis: 'security', file: 'src/a.ts', line: 9, summary: 'Detected calls to child_process', fate: 'reported', reason: '', gate: 'sast', sha: 'abc' },
    ]);
  });

  it('makes each reasoned suppression a sast suppression, naming the rule and line', () => {
    const records = sastObservations(base, 'abc', { gate: 'sast', pass: true, suppressed: [{ ...f, reason: 'our own input' }] });
    expect(records).toEqual([{ ...base, kind: 'suppression', gate: 'sast', file: 'src/a.ts:4', reason: `${f.rule}: our own input` }]);
  });

  it('records nothing for a run that could not run or found nothing', () => {
    expect(sastObservations(base, 'abc', { gate: 'sast', pass: false, error: 'no semgrep' })).toEqual([]);
    expect(sastObservations(base, 'abc', { gate: 'sast', pass: true, findings: [], warnings: [], suppressed: [] })).toEqual([]);
  });
});
