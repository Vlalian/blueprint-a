// node gates/hidden-unicode/cli.ts (--staged | --base <ref>) [--cwd <dir>]
// Scans only the lines the change adds. Exit 0 pass, 1 fail, 2 could not run.

import { parseArgs } from 'node:util';
import { changedLines } from '../lib/changes.ts';
import { emit, failClosed } from '../lib/contract.ts';
import { scanHiddenUnicode } from './core.ts';

const { values } = parseArgs({
  options: { staged: { type: 'boolean', default: false }, base: { type: 'string' }, cwd: { type: 'string' } },
});

emit(
  failClosed('hidden-unicode', () => {
    const findings = scanHiddenUnicode(changedLines(values.cwd ?? process.cwd(), values));
    return { gate: 'hidden-unicode', pass: findings.length === 0, findings };
  }),
);
