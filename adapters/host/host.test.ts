import { describe, expect, it } from 'vitest';
import { isFullSha, needFullSha, snapshotOf, sortChecks, verdictOf } from './host.ts';

const SHA = 'a'.repeat(40);

describe('snapshotOf', () => {
  it('is green when everything that reported passed', () => {
    expect(snapshotOf(SHA, [['test', 'passed'], ['lint', 'passed']])).toEqual({ sha: SHA, state: 'green', passed: ['test', 'lint'], failing: [], pending: [] });
  });

  it('is failing on one failure, even while others still run', () => {
    expect(snapshotOf(SHA, [['test', 'pending'], ['build', 'failing'], ['lint', 'passed']])).toEqual({ sha: SHA, state: 'failing', passed: ['lint'], failing: ['build'], pending: ['test'] });
  });

  it('is pending while something runs, and when nothing reported yet', () => {
    expect(snapshotOf(SHA, [['test', 'pending'], ['lint', 'passed']]).state).toBe('pending');
    expect(snapshotOf(SHA, []).state).toBe('pending');
  });
});

describe('sortChecks', () => {
  it('names each check under its verdict, in order', () => {
    expect(sortChecks([['b', 'failing'], ['a', 'passed'], ['c', 'pending'], ['d', 'passed']])).toEqual({ passed: ['a', 'd'], failing: ['b'], pending: ['c'] });
  });
});

describe('verdictOf', () => {
  it('maps green to VERIFIED, failing to FAILED and pending to NOT-VERIFIED', () => {
    expect(verdictOf('green')).toBe('VERIFIED');
    expect(verdictOf('failing')).toBe('FAILED');
    expect(verdictOf('pending')).toBe('NOT-VERIFIED');
  });
});

describe('full SHAs', () => {
  it('takes only 40 lower-case hex characters', () => {
    expect(isFullSha(SHA)).toBe(true);
    expect(isFullSha('a'.repeat(39))).toBe(false);
    expect(isFullSha(`x${SHA}`)).toBe(false);
    expect(isFullSha(`${SHA}x`)).toBe(false);
    expect(isFullSha('A'.repeat(40))).toBe(false);
  });

  it('refuses to read CI for anything else', () => {
    expect(() => needFullSha(SHA)).not.toThrow();
    expect(() => needFullSha('HEAD')).toThrow('CI is read for a full 40-character SHA, not "HEAD"');
  });
});
