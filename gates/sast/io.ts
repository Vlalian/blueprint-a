// The sast gate's real I/O (ticket 60): Semgrep and git spawned without a shell, files under the
// worktree. Semgrep from pip is `semgrep` on Linux and `semgrep.exe` on Windows, which Node finds
// on PATH without a shell. PYTHONUTF8=1 keeps Semgrep's Python reading and writing UTF-8 on Windows,
// where the console code page would otherwise apply.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SastCliIo } from './gate.ts';

/** The pinned rules folder beside this file. */
export const SAST_RULES = join(import.meta.dirname, 'rules');

/** 256 MiB of Semgrep JSON or git output. */
const BUFFER = 268_435_456;

/** Semgrep's command: `semgrep` on PATH (semgrep.exe on Windows). */
export const DEFAULT_SEMGREP = 'semgrep';

/** The I/O for a worktree; `command` is the Semgrep to run. */
export function realSastIo(cwd: string, command = DEFAULT_SEMGREP): SastCliIo {
  return {
    semgrep: (args, at) => {
      // nosemgrep: javascript.lang.security.detect-child-process -- the command is the Semgrep program the operator names (default `semgrep`), the arguments are an array, no shell runs
      const r = spawnSync(command, args, { cwd: at, encoding: 'utf8', maxBuffer: BUFFER, env: { ...process.env, PYTHONUTF8: '1' } });
      return { status: r.status, stdout: r.stdout ?? '', ...(r.error === undefined ? {} : { error: r.error }) };
    },
    readHead: (file) => {
      const path = join(cwd, ...file.split('/'));
      return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
    },
    tempDir: () => mkdtempSync(join(tmpdir(), 'sast-base-')),
    write: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    remove: (dir) => rmSync(dir, { recursive: true, force: true }),
    git: (args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: BUFFER }),
  };
}
