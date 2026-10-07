// node gates/red-check/cli.ts --base <ref> [--test-command "npx vitest run"] [--allow <file>]… [--cwd <dir>]
// Runs every new or changed test file against the code at <ref>; each must fail there, and a
// round with no new or changed test file fails (ticket 35).
// Exit 0 pass, 1 fail, 2 could not run. The logic is in gate.ts.
//
// The base is checked out as a temporary git worktree under <cwd>/.red-check/ (listed in
// .git/info/exclude, removed afterwards), so node_modules resolves from the project.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { git } from '../lib/git.ts';
import { isTestFile } from '../lib/test-files.ts';
import { ensureTempDirExcluded, excludeFile } from './exclude.ts';
import { testCommandLine } from './core.ts';
import { redCheckGate } from './gate.ts';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    'test-command': { type: 'string', default: 'npx vitest run' },
    allow: { type: 'string', multiple: true, default: [] },
    cwd: { type: 'string' },
  },
});
const cwd = values.cwd ?? process.cwd();

const lines = (text: string) => text.split('\n').filter(Boolean);

function changedTests(base: string): string[] {
  // --no-renames: a moved and edited test reads as R, which AM would leave out (review #25).
  const tracked = lines(git(cwd, 'diff', '--name-only', '--no-renames', '--diff-filter=AM', base, '--'));
  const untracked = lines(git(cwd, 'ls-files', '--others', '--exclude-standard'));
  return [...new Set([...tracked, ...untracked])].filter((p) => isTestFile(p) && !p.startsWith('.red-check/'));
}

const readIfThere = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

function excludeTempDir() {
  ensureTempDirExcluded(excludeFile(cwd, git(cwd, 'rev-parse', '--git-common-dir').trim()), {
    read: readIfThere,
    makeDir: (path) => mkdirSync(path, { recursive: true }),
    write: (path, text) => writeFileSync(path, text),
  });
}

emit(
  failClosed('red-check', () =>
    redCheckGate(values, {
      changedTests,
      checkoutBase: (base) => {
        excludeTempDir();
        const dir = join(cwd, '.red-check', `base-${process.pid}`);
        git(cwd, 'worktree', 'add', '--detach', '--force', dir, base);
        return { dir, remove: () => git(cwd, 'worktree', 'remove', '--force', dir) };
      },
      copyInto: (dir, file) => {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        copyFileSync(join(cwd, file), join(dir, file));
      },
      runTest: (dir, file) =>
        spawnSync(testCommandLine(values['test-command'], file, process.platform), { cwd: dir, shell: true, timeout: 5 * 60 * 1000 }).status ?? -1,
    }),
  ),
);
