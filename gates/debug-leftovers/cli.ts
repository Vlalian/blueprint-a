// node gates/debug-leftovers/cli.ts --base <ref> --config <project.json> [--cwd <dir>]
// No debug leftovers (ticket 47) as a role check: fails when the worktree, against <ref> and with
// its untracked files, adds a console.log, console.debug or debugger line to a source file that is
// not a test and not on the project's "printAllowed" list. The Stop gate runs the same judgement
// on its own; a cloud role runs this one. Exit 0 pass, 1 fail, 2 could not run (no diff at <ref>).

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { worktreeDiff } from '../four-checks/tree.ts';
import { debugLeftovers, printAllowedOf } from './core.ts';

const { values } = parseArgs({ options: { base: { type: 'string' }, config: { type: 'string' }, cwd: { type: 'string' } } });
const cwd = values.cwd ?? process.cwd();

function judged(base: string, config: string) {
  const diff = worktreeDiff(cwd, base);
  if (diff === undefined) throw new Error(`git gives no diff against ${base} in ${cwd}`);
  const found = debugLeftovers(diff, printAllowedOf(readFileSync(config, 'utf8')));
  return { gate: 'debug-leftovers', pass: found.length === 0, base, found };
}

// process.exitCode, never process.exit(): exiting right after a write to a piped stderr crashes
// Node on Windows (exit 0xC0000409).
if (!values.base || !values.config || !existsSync(values.config)) {
  process.stderr.write('usage: debug-leftovers --base <ref> --config <project.json> [--cwd <dir>]\n');
  process.exitCode = 2;
} else {
  const { base, config } = values;
  emit(failClosed('debug-leftovers', () => judged(base, config)));
}
