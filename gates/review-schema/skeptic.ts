// The skeptic's verdict on one HIGH finding: {"refuted": boolean, "evidence": string}. Fails
// closed the other way round from a review: output that cannot be read never refutes, so a
// broken skeptic leaves the finding standing.

import { isObject, isText, readJsonOutput, type ReviewerOutput } from './schema.ts';

export interface Refutation {
  refuted: boolean;
  evidence: string;
}

const SHAPE = 'skeptic output must be {"refuted": boolean, "evidence": non-empty string}';

function shapeError(v: unknown): string | undefined {
  const ok = isObject(v) && typeof v.refuted === 'boolean' && isText(v.evidence) && Object.keys(v).length === 2;
  return ok ? undefined : SHAPE;
}

export function validateRefutation(r: ReviewerOutput): Refutation {
  const parsed = readJsonOutput(r, 'skeptic');
  const error = 'error' in parsed ? parsed.error : shapeError(parsed.value);
  if (error) return { refuted: false, evidence: `skeptic output invalid (${error}); the finding stands` };
  return (parsed as { value: Refutation }).value;
}
