// The real I/O for the Python adapter (adapter.ts) and the Python parts of the gates: files, temp
// folders, and the project's Python tools started with no shell. PYTHONUTF8=1 keeps the tools
// reading and writing UTF-8 on Windows, where the console code page would otherwise apply. All
// decisions are in adapter.ts and toolchain.ts.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedLines } from '../../gates/lib/changes.ts';
import type { PythonIo } from './adapter.ts';
import { pythonToolchain, ranOf, type PythonToolchain } from './toolchain.ts';

const SKIPPED_DIRS = ['.venv', 'venv', 'node_modules', '__pycache__', '.git'];
const BUFFER = 268_435_456; // 256 MiB of tool output.

/** The project's Python and its tools, run in `cwd`. */
export function realToolchain(cwd: string): PythonToolchain {
  return pythonToolchain(cwd, {
    spawn: (command, args, at, env) => ranOf(spawnSync(command, args, { cwd: at, encoding: 'utf8', maxBuffer: BUFFER, env: { ...process.env, PYTHONUTF8: '1', ...env } })),
    exists: existsSync,
    env: process.env,
    platform: process.platform,
  });
}

/** Every file under a folder, its skipped folders left out; a file is itself. */
function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  const entries = readdirSync(path).filter((name) => !SKIPPED_DIRS.includes(name));
  return entries.flatMap((name) => filesUnder(join(path, name)));
}

export function pythonIo(cwd: string): PythonIo {
  return {
    read: (path) => readFileSync(path, 'utf8'),
    write: (path, text) => writeFileSync(path, text),
    tempDir: () => mkdtempSync(join(tmpdir(), 'test-strength-python-')),
    remove: (dir) => rmSync(dir, { recursive: true, force: true }),
    pyFiles: (path) => filesUnder(path).filter((f) => f.endsWith('.py')).sort(),
    changedLines: (base) => changedLines(cwd, { base }),
    tools: realToolchain(cwd),
  };
}
