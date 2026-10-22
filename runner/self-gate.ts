// node scripts/self-gate.ts [--base <ref>] [--integration] [--merge <branch>] [--report <branch>]
// Runs the workflow's gates on the workflow's own code: typecheck, unit tests, optionally the
// slow integration tests, then onkel (CRAP + mutation) on the source files changed since <ref>
// (config/runner.json's integration branch without --base).
// --merge is the fast merge gate (ticket 31): one unit run with coverage, only the unit and
// integration tests the change can reach (ticket 56; dependency-cruiser is run for the graph), and
// mutation only of the lines the merge changed relative to the tip its CI report gated (config/runner.json names its folder and every other repo setting, ticket 83).
// Exit 0 when every gate passes, 1 when one fails, 2 when one could not run. Every decision is in
// self-gate-main.ts; this file only wires in git, the processes, the files, the clock and the
// repo's merge check (config/runner.json mergeCheck, loaded here as an import of the repo file).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMergeCheck } from './merge-check.ts';
import { parseRunnerConfig, RUNNER_CONFIG } from './runner-config.ts';
import { selfGate } from './self-gate-main.ts';
import type { Step } from './self-gate-run.ts';

const ROOT = resolve(import.meta.dirname, '..');

const run = ({ name, command, args }: Step) => {
  process.stdout.write(`\n=== ${name}\n`);
  const r = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  process.stdout.write(`=== ${name}: exit ${r.status}\n`);
  return r.status;
};

const inFolder = (path: string) => mkdirSync(dirname(path), { recursive: true });

// A missing file or a folder (the root, for git's trailing empty line) reads as no file.
const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

// A config or module that cannot be read reaches selfGate as its error, which it reports with exit 2.
const mergeCheck = await Promise.resolve()
  .then(() => loadMergeCheck(parseRunnerConfig(read(join(ROOT, RUNNER_CONFIG))), (path) => import(pathToFileURL(join(ROOT, path)).href)))
  .catch((e: unknown) => e as Error);

// Exit codes are set, never forced with process.exit(): exiting right after a write to a piped
// stdout crashes Node on Windows (libuv assertion, exit 0xC0000409), as in gates/lib/contract.ts.
process.exitCode = selfGate(process.argv.slice(2), process.env, {
  root: ROOT,
  git: (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
  run,
  capture: (command, args) => spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }),
  read,
  write: (path, text) => (inFolder(path), writeFileSync(path, text)),
  append: (path, text) => (inFolder(path), appendFileSync(path, text)),
  exists: existsSync,
  tempDir: () => mkdtempSync(join(tmpdir(), 'self-gate-')),
  clock: () => performance.now(),
  now: () => new Date().toISOString(),
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
  mergeCheck,
});
