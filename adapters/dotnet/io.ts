// The real I/O for the .NET adapter (adapter.ts): files, temp folders, and `dotnet` started from
// PATH with no shell (dotnet is an .exe on Windows, so no .cmd shim is involved). A dotnet that
// cannot be started is reported as missing, never as a red run. All decisions are in adapter.ts.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ranDotnet, type DotnetIo } from './adapter.ts';

export function dotnetIo(cwd: string): DotnetIo {
  return {
    read: (path) => readFileSync(path, 'utf8'),
    exists: (path) => existsSync(path),
    find: (dir, name) =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name === name)
        .map((e) => join(e.parentPath, e.name)),
    tempDir: () => mkdtempSync(join(tmpdir(), 'test-strength-dotnet-')),
    remove: (dir) => rmSync(dir, { recursive: true, force: true }),
    dotnet: (args) => ranDotnet(spawnSync('dotnet', args, { cwd, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })),
  };
}
