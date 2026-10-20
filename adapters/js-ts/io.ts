// The real I/O for the JS/TS adapter (adapter.ts): files, temp folders, and each tool started as
// `node <its JS entry>` resolved from the project the way Node resolves it. No shell, so a path
// with a space survives and Windows needs no .cmd shim. All decisions are in adapter.ts.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BINS, type JsTsIo, type Tool } from './adapter.ts';

function entryOf(cwd: string, tool: Tool): string {
  const [pkg, entry] = BINS[tool];
  return join(dirname(createRequire(join(resolve(cwd), 'package.json')).resolve(`${pkg}/package.json`)), entry);
}

export function jsTsIo(cwd: string): JsTsIo {
  return {
    read: (path) => readFileSync(path, 'utf8'),
    exists: (path) => existsSync(path),
    write: (path, text) => writeFileSync(path, text, 'utf8'),
    tempDir: () => mkdtempSync(join(tmpdir(), 'test-strength-')),
    remove: (dir) => rmSync(dir, { recursive: true, force: true }),
    runBin: (tool, args) => {
      const r = spawnSync(process.execPath, [entryOf(cwd, tool), ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return { status: r.status, output: [r.stdout, r.stderr].join('') };
    },
  };
}
