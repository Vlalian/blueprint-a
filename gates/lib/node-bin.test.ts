import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { binCommand } from './node-bin.ts';

const ROOT = resolve(import.meta.dirname, '../..');

// npx and npm are .cmd shims on Windows, which spawn and execFile cannot start without a shell
// (null status, ENOENT). Every tool is therefore started as `node <its JS entry>`.
describe('binCommand — a package bin run through this Node, never npx', () => {
  it.each([
    ['vitest', join('vitest', 'vitest.mjs')],
    ['stryker', join('@stryker-mutator', 'core', 'bin', 'stryker.js')],
    ['tsc', join('typescript', 'bin', 'tsc')],
  ] as const)('starts %s as process.execPath with its JS entry first', (tool, entry) => {
    const [command, args] = binCommand(ROOT, tool, ['run', '--x']);
    expect(command).toBe(process.execPath);
    // Node resolves through a symlinked or junctioned node_modules (Stryker's sandbox) to the real path.
    expect(args).toEqual([realpathSync(join(ROOT, 'node_modules', entry)), 'run', '--x']);
    expect(existsSync(args[0]!)).toBe(true);
  });

  it('resolves the package from the project it is given, and throws when the project lacks it', () => {
    expect(() => binCommand(join(ROOT, 'fixtures'), 'stryker', [])).not.toThrow();
    expect(() => binCommand('/no/such/project', 'vitest', [])).toThrow(/vitest/);
  });
});
