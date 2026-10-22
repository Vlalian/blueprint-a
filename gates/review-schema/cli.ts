// node gates/review-schema/cli.ts --output <file> --exit-code <n>
// Checks one reviewer's output against the review JSON schema. Fails closed: a crashed reviewer
// (non-zero exit), a missing or empty file, or malformed JSON blocks. Logic in gate.ts and schema.ts.
// Exit 0 valid, 1 blocked, 2 could not run.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { reviewSchemaGate } from './gate.ts';

const OPTIONS = { output: { type: 'string' }, 'exit-code': { type: 'string' } } as const;
const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

// parseArgs runs inside failClosed, so an unknown option exits 2, never 1.
emit(failClosed('review-schema', () => reviewSchemaGate(parseArgs({ options: OPTIONS }).values, { read })));
