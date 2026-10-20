import { describe, expect, it } from 'vitest';
import type { SonarRef } from '../../adapters/sonarqube/config.ts';
import type { AnalysisLook, QualityGate, SonarIssue } from '../../adapters/sonarqube/sonarqube.ts';
import { exitCodeFor, failClosed } from '../lib/contract.ts';
import { gateVerdict, sonarQubeGate, type SonarQubeGateIo } from './gate.ts';

const SHA = 'c'.repeat(40);
const OLD = 'b'.repeat(40);
const REF: SonarRef = { pullRequest: '42' };

const PASSED: QualityGate = { status: 'OK', conditions: [{ metric: 'new_coverage', status: 'OK', comparator: 'LT', threshold: '80', actual: '91.3' }] };
const FAILED: QualityGate = {
  status: 'ERROR',
  conditions: [
    { metric: 'new_coverage', status: 'ERROR', comparator: 'LT', threshold: '80', actual: '51.2' },
    { metric: 'new_duplicated_lines_density', status: 'OK', comparator: 'GT', threshold: '3', actual: '0.0' },
    { metric: 'new_violations', status: 'ERROR', comparator: 'GT', threshold: '0', actual: '2' },
  ],
};
const ISSUE: SonarIssue = { key: 'AY1', rule: 'common-ts:DuplicatedBlocks', type: 'CODE_SMELL', severity: 'MAJOR', impacts: [], file: 'src/a.ts', message: '1 duplicated block.', status: 'OPEN' };
const MEASURES = { coverage: 91.3 };

function io(look: AnalysisLook, qg: QualityGate = PASSED) {
  const calls: string[] = [];
  const i: SonarQubeGateIo = {
    resolveSha: (ref) => (calls.push(`resolve ${ref}`), SHA),
    awaitAnalysis: (sha, ref) => (calls.push(`await ${sha.slice(0, 3)} ${JSON.stringify(ref)}`), look),
    sonar: {
      qualityGate: (target) => (calls.push(`gate ${JSON.stringify(target)}`), qg),
      newIssues: (ref) => (calls.push(`issues ${JSON.stringify(ref)}`), [ISSUE]),
      newCodeMeasures: (ref) => (calls.push(`measures ${JSON.stringify(ref)}`), MEASURES),
    },
  };
  return { io: i, calls };
}

const DONE: AnalysisLook = { state: 'done', analysisId: 'AX-1', date: '2026-10-06T10:00:00+0000', boundBy: 'task' };

describe('sonarqube gate', () => {
  it('is VERIFIED (exit 0) when the analysis of the exact head commit passed its quality gate, read by that analysis', () => {
    const { io: i, calls } = io(DONE);
    const r = sonarQubeGate({ ref: REF }, i);
    expect(r).toMatchObject({ gate: 'sonarqube', pass: true, sha: SHA, verdict: 'VERIFIED', analysis: 'done', analysisId: 'AX-1', boundBy: 'task', qualityGate: 'OK', failing: [], conditions: PASSED.conditions, measures: MEASURES });
    expect(exitCodeFor(r)).toBe(0);
    expect(calls).toEqual(['resolve HEAD', 'await ccc {"pullRequest":"42"}', 'issues {"pullRequest":"42"}', 'gate {"analysisId":"AX-1"}', 'measures {"pullRequest":"42"}']);
  });

  it('resolves the ref it is given', () => {
    const { io: i, calls } = io(DONE);
    sonarQubeGate({ sha: 'ticket/07', ref: REF }, i);
    expect(calls[0]).toBe('resolve ticket/07');
  });

  it('is FAILED (exit 1) with the conditions that failed when the quality gate failed', () => {
    const r = sonarQubeGate({ ref: REF }, io(DONE, FAILED).io);
    expect(r).toMatchObject({ pass: false, verdict: 'FAILED', qualityGate: 'ERROR', failing: [FAILED.conditions[0], FAILED.conditions[2]], conditions: FAILED.conditions });
    expect(exitCodeFor(r)).toBe(1);
  });

  it('is NOT-VERIFIED when the project has no quality gate', () => {
    expect(sonarQubeGate({ ref: REF }, io(DONE, { status: 'NONE', conditions: [] }).io)).toMatchObject({ pass: false, verdict: 'NOT-VERIFIED', qualityGate: 'NONE' });
  });

  it.each([
    ['running', { state: 'running' } as AnalysisLook, 'the analysis of this commit is still running'],
    ['none', { state: 'none' } as AnalysisLook, 'SonarQube has no analysis of this commit'],
    ['failed', { state: 'failed' } as AnalysisLook, 'the analysis of this commit failed in SonarQube'],
    ['unbound', { state: 'unbound' } as AnalysisLook, "SonarQube's API names no commit for a pull request analysis: give the task the scanner submitted for this commit (ceTaskId in its report-task.txt)"],
  ])('is NOT-VERIFIED (exit 1) and asks for nothing more when the analysis is %s', (state, look, detail) => {
    const { io: i, calls } = io(look);
    const r = sonarQubeGate({ ref: REF }, i);
    expect(r).toEqual({ gate: 'sonarqube', pass: false, sha: SHA, verdict: 'NOT-VERIFIED', analysis: state, detail });
    expect(exitCodeFor(r)).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('is NOT-VERIFIED, never a pass, when the newest analysis is of an older commit, naming that commit', () => {
    const { io: i, calls } = io({ state: 'stale', revision: OLD, date: '2026-10-05T10:00:00+0000' });
    expect(sonarQubeGate({ ref: REF }, i)).toEqual({ gate: 'sonarqube', pass: false, sha: SHA, verdict: 'NOT-VERIFIED', analysis: 'stale', detail: 'the newest analysis is of an older commit', analysedRevision: OLD });
    expect(calls).toHaveLength(2);
  });

  it('carries the new-code issues as sonarqube findings', () => {
    const r = sonarQubeGate({ ref: REF }, io(DONE).io);
    expect(r.findings).toEqual([expect.objectContaining({ source: 'sonarqube', id: 'sonarqube-AY1', rule: 'common-ts:DuplicatedBlocks', file: 'src/a.ts', classification: 'style', gate: 'duplication', sha: SHA })]);
    expect(r).not.toHaveProperty('comparison');
  });

  it('compares with our own findings when it is given them', () => {
    const r = sonarQubeGate({ ref: REF, ours: [{ gate: 'onkel', file: 'src/b.ts' }] }, io(DONE).io);
    expect(r.comparison).toEqual({
      escapes: [expect.objectContaining({ id: 'sonarqube-AY1' })],
      oursOnly: [{ gate: 'onkel', file: 'src/b.ts' }],
      overlap: [
        { gate: 'duplication', sonarqube: 1, ours: 0, both: 0 },
        { gate: 'onkel', sonarqube: 0, ours: 1, both: 0 },
      ],
    });
  });

  it('could not run (exit 2) when the server cannot be read', () => {
    const i = io(DONE).io;
    const r = failClosed('sonarqube', () => sonarQubeGate({ ref: REF }, { ...i, awaitAnalysis: () => { throw new Error('SonarQube GET api/ce/component answered 401'); } }));
    expect(exitCodeFor(r)).toBe(2);
  });
});

describe('gateVerdict', () => {
  it.each([
    ['OK', 'VERIFIED'],
    ['ERROR', 'FAILED'],
    ['NONE', 'NOT-VERIFIED'],
    ['WARN', 'NOT-VERIFIED'],
    ['toString', 'NOT-VERIFIED'],
  ])('%s is %s', (status, verdict) => {
    expect(gateVerdict(status)).toBe(verdict);
  });
});
