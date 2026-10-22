// node gates/four-checks/cli.ts --config <project.json> [--cwd <dir>]
// Prints the gate result as JSON. Exit 0 pass, 1 fail, 2 could not run (see gates/lib/contract.ts).

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { runChecks } from './check.ts';
import { shellRunner } from './runner.ts';

function checksIn(path: string): Record<string, string> {
  return (JSON.parse(readFileSync(path, 'utf8')) as { checks?: Record<string, string> }).checks ?? {};
}

const cwdOf = (cwd: string | undefined) => cwd ?? process.cwd();
const configExists = (path: string | undefined) => path !== undefined && existsSync(path);

// process.exitCode, never process.exit(): exiting right after a write to a piped stderr crashes
// Node on Windows (exit 0xC0000409), and the caller would read a crash instead of 2.
emit(failClosed('four-checks', () => {
  const { values } = parseArgs({ options: { config: { type: 'string' }, cwd: { type: 'string' } } });
  const cwd = cwdOf(values.cwd);
  if (!configExists(values.config)) {
    process.stderr.write('usage: four-checks --config <project.json> [--cwd <dir>]\n');
    throw new Error('usage: four-checks --config <project.json> [--cwd <dir>]');
  }
  // Reading the config runs inside failClosed, so a config that is not JSON exits 2, never 1.
  return runChecks(checksIn(values.config!), shellRunner, cwd);
}));
