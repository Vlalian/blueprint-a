// node gates/duplication/cli.ts --base <ref> [--cwd <dir>]
// Fails when jscpd finds a clone that involves a line added since <ref> (untracked files count
// as added). Clones wholly in untouched code pass. Exit 0 pass, 1 fail, 2 could not run. The
// logic is in gate.ts.
//
// jscpd is this repo's devDependency, run from here so a project needs no install of its own.
// Its report goes to a temporary folder outside the project, removed afterwards.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { changedLines } from '../lib/changes.ts';
import { emit, failClosed } from '../lib/contract.ts';
import { duplicationGate } from './gate.ts';

function jscpdReport(cwd: string): string {
  const out = mkdtempSync(join(tmpdir(), 'jscpd-'));
  try {
    const jscpd = createRequire(import.meta.url).resolve('jscpd/run-jscpd.js');
    execFileSync(process.execPath, [jscpd, '--reporters', 'json', '--output', out, '--silent', '--ignore', '**/node_modules/**', '.'], { cwd });
    return readFileSync(join(out, 'jscpd-report.json'), 'utf8');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// parseArgs runs inside failClosed, so an unknown option exits 2, never 1.
emit(
  failClosed('duplication', () => {
    const { values } = parseArgs({ options: { base: { type: 'string' }, cwd: { type: 'string' } } });
    const cwd = values.cwd ?? process.cwd();
    return duplicationGate(values, { changedLines: (base) => changedLines(cwd, { base }), jscpdReport: () => jscpdReport(cwd) });
  }),
);
