// node gates/canary/cli.ts [--root <dir>] [--state <dir>]
// Reruns every gate's prove-it-bites test under --root (default: this repo), each in its own vitest
// process, and with --state appends each gate's canary state to <dir>/logs/observations.jsonl.
// The folders searched are <root>/config/canary.json's (default: gates and adapters).
// Exit 0 when every gate still bites, 1 when one no longer does, 2 when it could not check them.
// The decisions are in core.ts; this file only wires in the file system and the processes.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { binCommand } from '../lib/node-bin.ts';
import { CANARY_CONFIG, childEnv, runCanary, sourceDirs, sourceFiles, vitestArgs, type CanaryIo } from './core.ts';

const ROOT = resolve(import.meta.dirname, '../..');
// The weekly rerun includes the slow integration bites tests (a real Stryker run each).
const TEST_TIMEOUT_MS = 30 * 60 * 1000;

const textAt = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);
const listed = (root: string, dir: string) => (existsSync(join(root, dir)) ? sourceFiles(dir, readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })) : []);

function runTest(root: string, file: string, integration: boolean) {
  const scratch = mkdtempSync(join(tmpdir(), 'canary-'));
  const report = join(scratch, 'report.jsonl');
  const [command, args] = binCommand(ROOT, 'vitest', vitestArgs(root, file, integration));
  const r = spawnSync(command, args, { cwd: root, env: childEnv(process.env, report), encoding: 'utf8', timeout: TEST_TIMEOUT_MS }); // nosemgrep: detect-child-process -- reruns each gate's own prove-it-bites test file through vitest, by design (the owner, 2026-10-21)
  const text = textAt(report);
  rmSync(scratch, { recursive: true, force: true });
  return { status: r.status, report: text };
}

const io = (root: string): CanaryIo => ({
  files: () => sourceDirs(textAt(join(root, CANARY_CONFIG))).flatMap((dir) => listed(root, dir)),
  runTest: (file, integration) => runTest(root, file, integration),
  now: () => new Date().toISOString(),
  append: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, text);
  },
});

// parseArgs runs inside failClosed, so an unknown option exits 2, never 1.
emit(
  failClosed('canary', () => {
    const { values } = parseArgs({ options: { root: { type: 'string' }, state: { type: 'string' } } });
    return runCanary(values.state, io(values.root ?? ROOT));
  }),
);
