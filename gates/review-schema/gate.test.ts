import { describe, expect, it } from 'vitest';
import { reviewSchemaGate } from './gate.ts';

const good = JSON.stringify({ findings: [] });
const read = (files: Record<string, string>) => (p: string) => files[p];

describe('reviewSchemaGate', () => {
  it('passes a well-formed review from a reviewer that exited 0', () => {
    expect(reviewSchemaGate({ output: 'r.json', 'exit-code': '0' }, { read: read({ 'r.json': good }) })).toEqual({
      gate: 'review-schema',
      pass: true,
      findings: [],
      errors: [],
    });
  });

  it('fails a reviewer that crashed', () => {
    const r = reviewSchemaGate({ output: 'r.json', 'exit-code': '137' }, { read: read({ 'r.json': good }) });
    expect(r.pass).toBe(false);
    expect(r.errors).toEqual(['reviewer crashed: exit code 137']);
  });

  it('fails when the output file is missing', () => {
    expect(reviewSchemaGate({ output: 'gone.json', 'exit-code': '0' }, { read: read({}) }).errors).toEqual(['reviewer output is empty']);
  });

  it('refuses to run without --output and --exit-code', () => {
    expect(() => reviewSchemaGate({ output: 'r.json' }, { read: read({}) })).toThrow('usage: review-schema --output <file> --exit-code <n>');
    expect(() => reviewSchemaGate({ 'exit-code': '0' }, { read: read({}) })).toThrow('usage');
  });

  it('refuses an exit code that is not a whole number', () => {
    for (const code of ['x', '1x', 'x1', '-1']) {
      expect(() => reviewSchemaGate({ output: 'r.json', 'exit-code': code }, { read: read({}) })).toThrow('usage');
    }
  });
});
