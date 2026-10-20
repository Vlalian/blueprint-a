// node gates/secret-scan/cli.ts (--staged | --base <ref>) [--cwd <dir>]
// Scans only the lines the change adds. Exit 0 pass, 1 fail, 2 could not run.

import { parseArgs } from 'node:util';
import { changedLines } from '../lib/changes.ts';
import { emit, failClosed } from '../lib/contract.ts';
import { scanSecrets } from './core.ts';

const { values } = parseArgs({
  options: { staged: { type: 'boolean', default: false }, base: { type: 'string' }, cwd: { type: 'string' } },
});

emit(
  failClosed('secret-scan', () => {
    const findings = scanSecrets(changedLines(values.cwd ?? process.cwd(), values));
    return { gate: 'secret-scan', pass: findings.length === 0, findings };
  }),
);
