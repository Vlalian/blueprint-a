import { describe, expect, it } from 'vitest';
import { validateRefutation } from './skeptic.ts';

const out = (v: unknown) => ({ exitCode: 0, output: JSON.stringify(v) });

describe('validateRefutation', () => {
  it('accepts a refutation with evidence', () => {
    expect(validateRefutation(out({ refuted: true, evidence: 'line 1 guards it' }))).toEqual({ refuted: true, evidence: 'line 1 guards it' });
  });

  it('accepts a finding that stands', () => {
    expect(validateRefutation(out({ refuted: false, evidence: 'checked; it fails' }))).toEqual({ refuted: false, evidence: 'checked; it fails' });
  });

  it('accepts the JSON inside a fence', () => {
    expect(validateRefutation({ exitCode: 0, output: '```json\n{"refuted": true, "evidence": "e"}\n```' }).refuted).toBe(true);
  });

  it('lets the finding stand when the skeptic crashed, even if its output says refuted', () => {
    expect(validateRefutation({ exitCode: 1, output: JSON.stringify({ refuted: true, evidence: 'e' }) })).toEqual({
      refuted: false,
      evidence: 'skeptic output invalid (skeptic crashed: exit code 1); the finding stands',
    });
  });

  it('lets the finding stand on empty or unparseable output', () => {
    expect(validateRefutation({ exitCode: 0, output: '' }).evidence).toBe('skeptic output invalid (skeptic output is empty); the finding stands');
    expect(validateRefutation({ exitCode: 0, output: undefined }).refuted).toBe(false);
    expect(validateRefutation({ exitCode: 0, output: '{' }).evidence).toMatch(/^skeptic output invalid \(skeptic output is not JSON: .*\); the finding stands$/);
  });

  it('lets the finding stand when the shape is wrong', () => {
    const bad = [{ refuted: 'yes', evidence: 'e' }, { refuted: true, evidence: ' ' }, { refuted: true }, { refuted: true, evidence: 'e', extra: 1 }, [], null];
    for (const v of bad) {
      expect(validateRefutation(out(v))).toEqual({
        refuted: false,
        evidence: 'skeptic output invalid (skeptic output must be {"refuted": boolean, "evidence": non-empty string}); the finding stands',
      });
    }
  });
});
