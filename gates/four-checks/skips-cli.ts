// node gates/four-checks/skips-cli.ts --base <ref> --report <file> --test "<test command>" [--cwd <dir>]
// The project's test check, run so that skipped tests are not green (ticket 47, skips.ts): the test
// command's own output and exit code, failed when its JSON report (<file>, from the folder it ran
// in) has more skipped or todo tests than at <ref>. `{CWD}` in the command is the worktree, so a
// command naming its node_modules runs in the base's checkout too. Exit 2 on a usage error.
//
// The base is checked out as a temporary git worktree under <cwd>/.red-check/ (listed in
// .git/info/exclude, removed afterwards), as the red check does. The skipped tests of each tree
// are kept under the repo's git folder (workflow-skips/), so a base the checks already ran on is
// never run again.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { git } from '../lib/git.ts';
import { ensureTempDirExcluded, excludeFile } from '../red-check/exclude.ts';
import { shellRunner } from './runner.ts';
import { guardedTest, type SkipsIo } from './skips.ts';
import { worktreeTree } from './tree.ts';

const { values } = parseArgs({ options: { base: { type: 'string' }, report: { type: 'string' }, test: { type: 'string' }, cwd: { type: 'string' } } });
const cwd = values.cwd ?? process.cwd();
const command = String(values.test).replaceAll('{CWD}', cwd.split('\\').join('/'));
const reportIn = (dir: string) => join(dir, String(values.report));

const readIfThere = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

function readAndRemove(path: string): string | undefined {
  const text = readIfThere(path);
  rmSync(path, { force: true });
  return text;
}

function checkoutBase(base: string) {
  const exclude = excludeFile(cwd, git(cwd, 'rev-parse', '--git-common-dir').trim());
  ensureTempDirExcluded(exclude, { read: readIfThere, makeDir: (path) => mkdirSync(path, { recursive: true }), write: writeFileSync });
  const dir = join(cwd, '.red-check', `skips-base-${process.pid}`);
  git(cwd, 'worktree', 'add', '--detach', '--force', dir, base);
  return { dir, remove: () => void spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd }) };
}

const io: SkipsIo = {
  test: (dir) => shellRunner(command, dir),
  report: (dir) => readAndRemove(reportIn(dir)),
  clearReport: (dir) => rmSync(reportIn(dir), { force: true }),
  tree: worktreeTree,
  treeOf: (ref) => git(cwd, 'rev-parse', `${ref}^{tree}`).trim(),
  checkoutBase,
  read: readIfThere,
  write: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
};

function run(base: string): void {
  const cache = join(resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir').trim()), 'workflow-skips');
  const r = guardedTest({ cwd, base, cache }, io);
  process.stdout.write(r.output);
  process.exitCode = r.exitCode;
}

// process.exitCode, never process.exit(): exiting right after a write to a piped stderr crashes
// Node on Windows (exit 0xC0000409).
if (!values.base || !values.report || !values.test) {
  process.stderr.write('usage: skips-cli --base <ref> --report <file> --test "<test command>" [--cwd <dir>]\n');
  process.exitCode = 2;
} else {
  run(values.base);
}
