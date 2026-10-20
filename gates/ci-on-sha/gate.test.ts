import { describe, expect, it } from 'vitest';
import type { CiSnapshot } from '../../adapters/host/host.ts';
import { snapshotOf } from '../../adapters/host/host.ts';
import { exitCodeFor, failClosed } from '../lib/contract.ts';
import { ciOnShaGate, type CiOnShaIo } from './gate.ts';

const SHA = 'd'.repeat(40);

function io(checks: Array<[string, 'passed' | 'failing' | 'pending']>, resolved = SHA): CiOnShaIo & { asked: string[]; read: string[] } {
  const asked: string[] = [];
  const read: string[] = [];
  return {
    resolveSha: (ref) => (asked.push(ref), resolved),
    host: { host: 'azure-devops', checksForCommit: (sha): CiSnapshot => (read.push(sha), snapshotOf(sha, checks)) },
    asked,
    read,
  };
}

describe('ci-on-sha gate', () => {
  it('passes (exit 0) only when CI is green on the exact SHA, resolving the ref it was given', () => {
    const i = io([['test', 'passed']]);
    const r = ciOnShaGate({ sha: 'ticket/01' }, i);
    expect(r).toEqual({ gate: 'ci-on-sha', pass: true, host: 'azure-devops', sha: SHA, ci: 'green', verdict: 'VERIFIED', passed: ['test'], failing: [], pending: [] });
    expect(exitCodeFor(r)).toBe(0);
    expect(i.asked).toEqual(['ticket/01']);
    expect(i.read).toEqual([SHA]);
  });

  it('checks HEAD when no SHA is given', () => {
    const i = io([['test', 'passed']]);
    ciOnShaGate({}, i);
    expect(i.asked).toEqual(['HEAD']);
  });

  it('fails (exit 1) FAILED when CI failed on the SHA', () => {
    const r = ciOnShaGate({}, io([['test', 'passed'], ['build', 'failing']]));
    expect(r).toMatchObject({ pass: false, ci: 'failing', verdict: 'FAILED', failing: ['build'] });
    expect(exitCodeFor(r)).toBe(1);
  });

  it('fails (exit 1) NOT-VERIFIED while CI is still running or has not reported: only green ships', () => {
    expect(ciOnShaGate({}, io([['test', 'pending']]))).toMatchObject({ pass: false, ci: 'pending', verdict: 'NOT-VERIFIED', pending: ['test'] });
    expect(ciOnShaGate({}, io([]))).toMatchObject({ pass: false, ci: 'pending', verdict: 'NOT-VERIFIED' });
  });

  it('could not run (exit 2) when the host cannot be read, never passing', () => {
    const r = failClosed('ci-on-sha', () =>
      ciOnShaGate({}, { resolveSha: () => SHA, host: { host: 'github', checksForCommit: () => { throw new Error('gh api failed: gh auth login'); } } }),
    );
    expect(r).toEqual({ gate: 'ci-on-sha', pass: false, error: 'gh api failed: gh auth login' });
    expect(exitCodeFor(r)).toBe(2);
  });
});
