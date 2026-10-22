// node gates/evidence/cli.ts --report <report.json> [--claim <text>] [--repo <dir>]
// node gates/evidence/cli.ts --walk <report.json> [--repo <dir>]
// Checks the evidence report for a Pass when claim the plan marked as needing non-test evidence,
// or with --walk a walker's walk report (ticket 23, walk-report.ts).
// Paths are relative to --repo. Exit 0 pass, 1 fail, 2 could not run. Logic in gate.ts.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { cliGate } from './gate.ts';

// parseArgs runs inside failClosed, so an unknown option exits 2, never 1.
emit(
  failClosed('evidence', () => {
    const { values } = parseArgs({ options: { report: { type: 'string' }, walk: { type: 'string' }, claim: { type: 'string' }, repo: { type: 'string' } } });
    const repo = values.repo ?? process.cwd();
    return cliGate(values, { read: (p) => readFileSync(join(repo, p), 'utf8'), exists: (p) => existsSync(join(repo, p)) });
  }),
);
