// @process-shell
// The real I/O of the flow tools (ticket 84, from scripts/flow/flow-io.ts and scripts/ship-io.ts):
// the repo is the folder the command runs in; files (folders made on write); git and gh as
// processes; config/flow.json's commands through a shell, their values as variables; the locks on their files; the host
// adapter config/flow.json names, Azure DevOps over HTTP in a child node (adapters/host/http.ts).
// Wiring only: the tools' cores take this as injected I/O and are tested with fakes.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { childHttp } from '../adapters/host/http.ts';
import type { ProcessResult } from '../adapters/host/process-result.ts';
import { lockFs } from '../runner/lock-fs.ts';
import { acquire, release } from '../runner/lock.ts';
import type { FlowIo } from './main.ts';
import { repoPath, upTo } from './state.ts';

const MB64 = 64 * 1024 * 1024;

const inFolder = (path: string) => mkdirSync(dirname(path), { recursive: true });

const FETCH_ONCE = upTo(import.meta.dirname, join('adapters', 'host', 'fetch-once.ts'), existsSync);

const run = (command: string, args: string[], cwd: string): ProcessResult =>
  // nosemgrep: javascript.lang.security.detect-child-process -- the command is git or gh, fixed by the callers below; the arguments are an array and no shell runs
  spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: MB64, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } }) as ProcessResult;

const lockOn = (path: string) => {
  inFolder(path);
  const io = lockFs(path);
  return { acquire: () => acquire(io), release: (token: string) => void release(token, io) };
};

/** Runs a shell command with `env` added and its output appended to `log`; its exit status. */
function logged(command: string, cwd: string, log: string, env: Record<string, string>): number | null {
  inFolder(log);
  const fd = openSync(log, 'a');
  try {
    // nosemgrep: javascript.lang.security.audit.spawn-shell-true, javascript.lang.security.detect-child-process -- the command is config/flow.json's, written by the repo's owner; values reach it only as variables (render)
    return spawnSync(command, { cwd, shell: true, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] }).status;
  } finally {
    closeSync(fd);
  }
}

const http = childHttp((input) => spawnSync(process.execPath, [FETCH_ONCE], { input, encoding: 'utf8', maxBuffer: MB64 }));

/** git in `cwd` that throws on a failing command, with git's stderr in the message. */
const gitThrowing = (cwd: string) => (args: string[], input?: string) => execFileSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: MB64, stdio: ['pipe', 'pipe', 'pipe'] });

/** A run stopped at its timeout says so. */
const timed = (r: ProcessResult) => ({ ...r, timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' });

const files = {
  read: (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
  write: (path: string, text: string) => (inFolder(path), writeFileSync(path, text)),
  append: (path: string, text: string) => (inFolder(path), appendFileSync(path, text)),
  exists: existsSync,
};

/** The flow's I/O for the repo at `root`. */
export function flowIo(root: string): FlowIo {
  return {
    root,
    ...files,
    git: (cwd, args) => run('git', args, cwd),
    platform: process.platform,
    // nosemgrep: javascript.lang.security.audit.spawn-shell-true, javascript.lang.security.detect-child-process -- the command is config/flow.json's, written by the repo's owner; values reach it only as variables (render)
    shell: (command, cwd, input, timeoutMs, env) => timed(spawnSync(command, { cwd, input, timeout: timeoutMs, shell: true, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: MB64 })),
    // nosemgrep: javascript.lang.security.audit.spawn-shell-true, javascript.lang.security.detect-child-process -- the command is config/flow.json's typecheck or after-merge command
    run: (command, cwd) => spawnSync(command, { cwd, shell: true, stdio: 'inherit' }).status,
    logged,
    lock: lockOn,
    ticketFiles: (folder) => readdirSync(repoPath(root, folder)),
    id: randomUUID,
    worktreeId: randomUUID,
    clock: () => performance.now(),
    now: () => new Date().toISOString(),
    out: (text) => void process.stdout.write(text),
    hostDeps: (cwd) => ({ gh: (args) => run('gh', args, cwd), http, env: process.env }),
    gitIn: gitThrowing,
    epochMs: Date.now,
    sleep: (ms) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    log: (line) => void process.stderr.write(`${line}\n`),
  };
}
