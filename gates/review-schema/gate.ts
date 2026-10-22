// The review-schema gate with its I/O passed in, so it is tested in-process. cli.ts only wires in
// the file system. A missing output file reads as empty output, which blocks.

import type { GateResult } from '../lib/contract.ts';
import { validateReview, type Finding } from './schema.ts';

export interface ReviewSchemaIo {
  /** The file's text, or undefined when it does not exist. */
  read(path: string): string | undefined;
}

const USAGE = 'usage: review-schema --output <file> --exit-code <n>';

export function reviewSchemaGate(opts: { output?: string; 'exit-code'?: string }, io: ReviewSchemaIo): GateResult & { findings: Finding[]; errors: string[] } {
  if (!opts.output || !/^\d+$/.test(String(opts['exit-code']))) throw new Error(USAGE);
  const r = validateReview({ exitCode: Number(opts['exit-code']), output: io.read(opts.output) });
  return { gate: 'review-schema', pass: r.ok, findings: r.findings, errors: r.errors };
}
