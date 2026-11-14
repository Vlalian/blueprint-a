// Ticket 48: the review skill checks the tests the four ways the build roles write them, spends
// its time where tooling cannot look, and has every Spec finding quote the line it rests on
// (Matt Pocock's tdd and code-review skills, v1.3.1).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SKILL = readFileSync(join(ROOT, 'skills', 'review', 'SKILL.md'), 'utf8');
const flat = SKILL.replace(/\s+/g, ' ');
const standards = flat.slice(flat.indexOf('**Standards:**'), flat.indexOf('**Spec:**'));

describe('review skill', () => {
  it('checks the tests the four ways under Standards', () => {
    expect(standards).toContain(
      'Check the tests four ways: they go through the public interface, mock only at system boundaries (network, clock, file system, model), compute the expected value independently of the code under test, and assert on the results a caller sees.',
    );
  });

  it('leaves to lint, typecheck and the gates what they already enforce', () => {
    expect(flat).toContain(
      'Spend your review on what tooling cannot see. Lint, typecheck and the gates already enforce formatting, types, complexity and surviving mutants; leave those to them.',
    );
  });

  it('has every Spec finding quote the ticket or plan line it rests on, in `quote`', () => {
    expect(flat).toContain('Every Spec finding quotes the ticket or plan line it rests on, word for word, in `quote`.');
  });

  it('gives a JSON example with every field, whose Spec finding quotes its line', () => {
    const json = /```json\n([\s\S]*?)\n```/.exec(SKILL)![1]!;
    const findings = (JSON.parse(json) as { findings: Array<Record<string, unknown>> }).findings;
    const fields = ['file', 'line', 'severity', 'axis', 'claim', 'scenario', 'fix', 'ticket', 'quote'];
    expect(findings.map((f) => Object.keys(f))).toEqual(findings.map(() => fields));
    expect(findings.some((f) => f.axis === 'spec' && typeof f.quote === 'string')).toBe(true);
  });

});
