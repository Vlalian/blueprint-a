import { describe, expect, it } from 'vitest';
import { REVIEW_SCHEMA, SEVERITIES, AXES, validateReview, type Finding } from './schema.ts';

const finding: Finding = {
  file: 'src/is-even.ts',
  line: 3,
  severity: 'HIGH',
  axis: 'spec',
  claim: 'isEven(-2) returns false',
  scenario: 'isEven(-2) gives false because -2 % 2 is -0 and the check compares with 1',
  fix: 'compare n % 2 with 0',
  ticket: '02',
};

const ok = (findings: unknown[]) => JSON.stringify({ findings });

describe('validateReview', () => {
  it('accepts a review with one well-formed finding and returns it', () => {
    expect(validateReview({ exitCode: 0, output: ok([finding]) })).toEqual({ ok: true, findings: [finding], errors: [] });
  });

  it('accepts a review with no findings: a clean review is a result, not a crash', () => {
    expect(validateReview({ exitCode: 0, output: ok([]) })).toEqual({ ok: true, findings: [], errors: [] });
  });

  it('accepts the JSON inside a ```json fence, as Claude often wraps it', () => {
    expect(validateReview({ exitCode: 0, output: `\`\`\`json\n${ok([finding])}\n\`\`\`\n` }).ok).toBe(true);
  });

  it('accepts a fence with blank space around it', () => {
    expect(validateReview({ exitCode: 0, output: `  \n\`\`\`json\n${ok([])}\n\`\`\`\n\n` }).ok).toBe(true);
  });

  it('blocks prose before or after the fenced JSON: the output must be the review and nothing else', () => {
    expect(validateReview({ exitCode: 0, output: `Here it is:\n\`\`\`json\n${ok([])}\n\`\`\`` }).ok).toBe(false);
    expect(validateReview({ exitCode: 0, output: `\`\`\`json\n${ok([])}\n\`\`\`\nDone.` }).ok).toBe(false);
  });

  it('accepts a fence without a language tag', () => {
    expect(validateReview({ exitCode: 0, output: `\`\`\`\n${ok([])}\n\`\`\`` }).ok).toBe(true);
  });

  it('blocks a reviewer that exited non-zero, even when its output parses', () => {
    expect(validateReview({ exitCode: 1, output: ok([]) })).toEqual({ ok: false, findings: [], errors: ['reviewer crashed: exit code 1'] });
  });

  it('blocks a reviewer that was killed (no exit code)', () => {
    expect(validateReview({ exitCode: null, output: ok([]) }).errors).toEqual(['reviewer crashed: exit code null']);
  });

  it('blocks empty output', () => {
    expect(validateReview({ exitCode: 0, output: '  \n' })).toEqual({ ok: false, findings: [], errors: ['reviewer output is empty'] });
  });

  it('blocks missing output', () => {
    expect(validateReview({ exitCode: 0, output: undefined }).errors).toEqual(['reviewer output is empty']);
  });

  it('blocks output that is not JSON', () => {
    const r = validateReview({ exitCode: 0, output: '{"findings": [' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^reviewer output is not JSON: /);
  });

  it('blocks JSON that is not an object with a findings array', () => {
    for (const output of ['[]', 'null', '"x"', '{}', '{"findings": {}}']) {
      expect(validateReview({ exitCode: 0, output }).errors).toEqual(['reviewer output must be an object with a "findings" array']);
    }
  });

  it('blocks an unknown top-level key', () => {
    expect(validateReview({ exitCode: 0, output: JSON.stringify({ findings: [], verdict: 'ok' }) }).errors).toEqual(['unknown key "verdict"']);
  });

  it('names every problem in a malformed finding and returns no findings', () => {
    const bad = { file: '', line: 0, severity: 'CRITICAL', axis: 'style', claim: 3, scenario: ' ', extra: true };
    const r = validateReview({ exitCode: 0, output: ok([finding, bad]) });
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.errors).toEqual([
      'findings[1].file must be a non-empty string',
      'findings[1].line must be a whole number of at least 1',
      'findings[1].severity must be one of HIGH, MEDIUM, LOW',
      'findings[1].axis must be one of standards, spec',
      'findings[1].claim must be a non-empty string',
      'findings[1].scenario must be a non-empty string',
      'findings[1].fix must be a non-empty string',
      'findings[1].ticket must be a non-empty string',
      'findings[1] has unknown key "extra"',
    ]);
  });

  it('blocks a finding that is not an object', () => {
    expect(validateReview({ exitCode: 0, output: ok(['x', null]) }).errors).toEqual(['findings[0] must be an object', 'findings[1] must be an object']);
  });

  it('blocks a fractional line and an empty ticket', () => {
    expect(validateReview({ exitCode: 0, output: ok([{ ...finding, line: 2.5, ticket: '' }]) }).errors).toEqual([
      'findings[0].line must be a whole number of at least 1',
      'findings[0].ticket must be a non-empty string',
    ]);
  });

  it('accepts line 1, the lowest line', () => {
    expect(validateReview({ exitCode: 0, output: ok([{ ...finding, line: 1 }]) }).ok).toBe(true);
  });

  // Ticket 48: a Spec finding quotes the ticket or plan line it rests on; the field is optional.
  it('accepts a finding with the ticket or plan line it rests on, and returns the quote', () => {
    const quoted = { ...finding, quote: 'isEven(n) is true for every even integer, negatives included' };
    expect(validateReview({ exitCode: 0, output: ok([quoted]) })).toEqual({ ok: true, findings: [quoted], errors: [] });
  });

  it('accepts a null quote, which Codex prints for a finding with nothing to quote', () => {
    expect(validateReview({ exitCode: 0, output: ok([{ ...finding, quote: null }]) }).ok).toBe(true);
  });

  it('blocks an empty or non-text quote', () => {
    for (const quote of ['', ' ', 3]) {
      expect(validateReview({ exitCode: 0, output: ok([{ ...finding, quote }]) }).errors).toEqual(['findings[0].quote must be a non-empty string or null']);
    }
  });

});

describe('REVIEW_SCHEMA', () => {
  it('is exactly the contract reviewers are given', () => {
    const text = { type: 'string', minLength: 1 };
    expect(REVIEW_SCHEMA).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['findings'],
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['file', 'line', 'severity', 'axis', 'claim', 'scenario', 'fix', 'ticket', 'quote'],
            properties: {
              file: text,
              line: { type: 'integer', minimum: 1 },
              severity: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
              axis: { type: 'string', enum: ['standards', 'spec'] },
              claim: text,
              scenario: text,
              fix: text,
              ticket: text,
              quote: { type: ['string', 'null'], minLength: 1 },
            },
          },
        },
      },
    });
  });

  it('is a closed JSON schema whose finding fields match what the validator requires', () => {
    expect(REVIEW_SCHEMA.required).toEqual(['findings']);
    expect(REVIEW_SCHEMA.additionalProperties).toBe(false);
    const item = REVIEW_SCHEMA.properties.findings.items;
    expect(item.required).toEqual(['file', 'line', 'severity', 'axis', 'claim', 'scenario', 'fix', 'ticket', 'quote']);
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.severity.enum).toEqual([...SEVERITIES]);
    expect(item.properties.axis.enum).toEqual([...AXES]);
    expect(item.properties.line).toEqual({ type: 'integer', minimum: 1 });
  });

  it('requires every property it lists, as strict structured output (Codex --output-schema) demands', () => {
    expect(Object.keys(REVIEW_SCHEMA.properties)).toEqual(REVIEW_SCHEMA.required);
    const item = REVIEW_SCHEMA.properties.findings.items;
    expect(Object.keys(item.properties)).toEqual(item.required);
  });
});
