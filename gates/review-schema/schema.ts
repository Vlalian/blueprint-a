// The review JSON schema and its validator. Every reviewer (Standards, Spec, Codex or its Claude
// stand-in, and nothing else) must print one object matching REVIEW_SCHEMA. The validator fails
// closed: a crashed, empty, unparseable or malformed review blocks and yields no findings, so a
// broken reviewer can never read as a clean one.

export const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const AXES = ['standards', 'spec'] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Axis = (typeof AXES)[number];

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  axis: Axis;
  /** What is wrong, in one sentence. */
  claim: string;
  /** The concrete input or state that shows it failing. */
  scenario: string;
  /** The suggested fix. */
  fix: string;
  /** The ticket whose change the finding is in; fix rounds run per ticket. */
  ticket: string;
  /** The ticket or plan line a Spec finding rests on, word for word; null or absent when none. */
  quote?: string | null;
}

const text = { type: 'string', minLength: 1 } as const;

/**
 * Strict-mode friendly: closed objects, every property required (Codex --output-schema needs it).
 * So the optional `quote` is required here but may be null; the validator also accepts it absent.
 */
export const REVIEW_SCHEMA = {
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
          severity: { type: 'string', enum: [...SEVERITIES] },
          axis: { type: 'string', enum: [...AXES] },
          claim: text,
          scenario: text,
          fix: text,
          ticket: text,
          quote: { type: ['string', 'null'], minLength: 1 },
        },
      },
    },
  },
};

export interface ReviewerOutput {
  exitCode: number | null;
  output: string | undefined;
}

export interface ReviewValidation {
  ok: boolean;
  findings: Finding[];
  errors: string[];
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isText = (v: unknown) => typeof v === 'string' && v.trim() !== '';
const blocked = (...errors: string[]): ReviewValidation => ({ ok: false, findings: [], errors });
const TEXT: Rule = [isText, 'must be a non-empty string'];
const oneOf = (allowed: readonly string[]): Rule => [(v) => allowed.includes(v as string), `must be one of ${allowed.join(', ')}`];

type Rule = [ok: (value: unknown) => boolean, problem: string];

/** One rule per finding field, in schema order, so the repair text reads top to bottom. */
const RULES: Record<string, Rule> = {
  file: TEXT,
  line: [(v) => Number.isInteger(v) && (v as number) >= 1, 'must be a whole number of at least 1'],
  severity: oneOf(SEVERITIES),
  axis: oneOf(AXES),
  claim: TEXT,
  scenario: TEXT,
  fix: TEXT,
  ticket: TEXT,
  quote: [(v) => v === undefined || v === null || isText(v), 'must be a non-empty string or null'],
};
const FIELDS = Object.keys(RULES);

/** The JSON text, without the ```json fence a model may wrap it in. */
function unfence(output: string): string {
  return /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/.exec(output)?.[1] ?? output;
}

function findingErrors(f: unknown, i: number): string[] {
  const at = `findings[${i}]`;
  if (!isObject(f)) return [`${at} must be an object`];
  const bad = Object.entries(RULES).filter(([field, [ok]]) => !ok(f[field]));
  const unknown = Object.keys(f).filter((k) => !FIELDS.includes(k));
  return [...bad.map(([field, [, problem]]) => `${at}.${field} ${problem}`), ...unknown.map((k) => `${at} has unknown key "${k}"`)];
}

function shapeErrors(parsed: unknown): string[] {
  if (!isObject(parsed) || !Array.isArray(parsed.findings)) return ['reviewer output must be an object with a "findings" array'];
  const unknown = Object.keys(parsed).filter((k) => k !== 'findings').map((k) => `unknown key "${k}"`);
  return [...unknown, ...parsed.findings.flatMap(findingErrors)];
}

/** An agent's JSON output, or why it cannot be used: a crash, nothing printed, or not JSON. */
export function readJsonOutput(r: ReviewerOutput, who: string): { value: unknown } | { error: string } {
  if (r.exitCode !== 0) return { error: `${who} crashed: exit code ${r.exitCode}` };
  if (!r.output?.trim()) return { error: `${who} output is empty` };
  try {
    return { value: JSON.parse(unfence(r.output)) };
  } catch (e) {
    return { error: `${who} output is not JSON: ${(e as Error).message}` };
  }
}

export function validateReview(r: ReviewerOutput): ReviewValidation {
  const parsed = readJsonOutput(r, 'reviewer');
  if ('error' in parsed) return blocked(parsed.error);
  const errors = shapeErrors(parsed.value);
  if (errors.length > 0) return blocked(...errors);
  return { ok: true, findings: (parsed.value as { findings: Finding[] }).findings, errors: [] };
}
