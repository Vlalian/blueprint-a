// node scripts/full-run.ts --why promote|idle   [WORKFLOW_STATE_DIR=<dir>]
// The whole test suite as the safety net under the fast merge gate's selection (ticket 56): run it
// when the integration branch is promoted to main, and once a night when the PC is idle. Every
// decision is in full-run-main.ts; this file only wires in git, the processes, the files and the clock.
// @process-shell

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fullRun } from './full-run-main.ts';
import type { Step } from './self-gate-run.ts';

const ROOT = resolve(import.meta.dirname, '..');

const run = ({ name, command, args }: Step) => {
  process.stdout.write(`\n=== ${name}\n`);
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' }).status;
};

// Exit codes are set, never forced with process.exit(): exiting right after a write to a piped
// stdout crashes Node on Windows (exit 0xC0000409).
process.exitCode = fullRun(process.argv.slice(2), process.env, {
  root: ROOT,
  git: (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }),
  run,
  read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
  append: (path, text) => (mkdirSync(dirname(path), { recursive: true }), appendFileSync(path, text)),
  exists: existsSync,
  tempDir: () => mkdtempSync(join(tmpdir(), 'full-run-')),
  clock: () => performance.now(),
  now: () => new Date().toISOString(),
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
});
