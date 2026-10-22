// The tamper gate's git and file system reads, shared by its CLI, a harness (the hooks fingerprint
// at the start of a role) and a pre-commit installer. Wiring only; the decisions are in core.ts and
// gate.ts.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { git } from '../lib/git.ts';
import { hooksFingerprint, type ApprovalIo, type HookFile } from './core.ts';
import type { TamperIo } from './gate.ts';
import { homeHooks, showAt } from './io.ts';

/** Paths git prints, NUL-separated so no name is quoted or split. */
const paths = (cwd: string, command: string, ...args: string[]) => git(cwd, command, '-z', ...args).split('\0').filter(Boolean);
const textOf = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

const isFolder = (path: string) => existsSync(path) && statSync(path).isDirectory();
const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

/** Every file under a folder, in subfolders too, links followed, named `<prefix>/<path>` ('/'-separated); [] when it is no folder. */
function folderFiles(dir: string, prefix: string): HookFile[] {
  // A hooks path that is no folder (`/dev/null`) holds no hooks; the fingerprint still names the path.
  const names = isFolder(dir) ? readdirSync(dir, { recursive: true, encoding: 'utf8' }) : [];
  return names.filter((n) => isFile(join(dir, n))).map((n) => ({ name: `${prefix}${n.split('\\').join('/')}`, text: readFileSync(join(dir, n), 'utf8') }));
}

/** A configured hook target: the file itself, or every file under the folder. */
const targetFiles = (top: string, target: string): HookFile[] => (isFile(join(top, target)) ? [{ name: target, text: readFileSync(join(top, target), 'utf8') }] : folderFiles(join(top, target), `${target}/`));

/**
 * The hook files: each file under the configured targets (relative to the repo top, ticket 82), or
 * without targets every file in the hooks folder git runs: core.hooksPath when set (git resolves a
 * relative one against the work tree, ticket 74), else .git/hooks, which worktrees share.
 */
export function hookFiles(cwd: string, targets?: string[]): HookFile[] {
  if (targets === undefined) return folderFiles(resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'hooks').trim()), '');
  const top = git(cwd, 'rev-parse', '--show-toplevel').trim();
  return targets.flatMap((t) => targetFiles(top, t));
}

/** The hook files and core.hooksPath (empty when unset). */
export const hooksOf = (cwd: string, targets?: string[]) => ({ files: hookFiles(cwd, targets), hooksPath: String(spawnSync('git', ['config', '--get-all', 'core.hooksPath'], { cwd, encoding: 'utf8' }).stdout).trim() });

/** The fingerprint the tamper gate compares against, taken now, of config/tamper.json's hook targets by default. */
export function repoHooksFingerprint(cwd: string, ignore: string[] = [], targets = homeHooks()): string {
  const hooks = hooksOf(cwd, targets);
  return hooksFingerprint(hooks.files, hooks.hooksPath, ignore);
}

type Changes = Pick<TamperIo, 'changed' | 'before' | 'after'>;

/** The pre-commit view: what is staged, against HEAD. */
export const stagedChanges = (top: string): Changes => ({
  changed: () => paths(top, 'diff', '--cached', '--name-only', '--no-renames'),
  before: (path) => showAt(top, 'HEAD', path),
  after: (path) => showAt(top, '', path),
});

/** The Stop gate's view: the working tree, untracked files included, against the base commit. */
export const baseChanges = (top: string, base: string): Changes => ({
  changed: () => [...paths(top, 'diff', '--name-only', '--no-renames', base, '--'), ...paths(top, 'ls-files', '--others', '--exclude-standard')],
  before: (path) => showAt(top, base, path),
  after: (path) => textOf(join(top, path)),
});

/** The view the mode asks for: the index in --staged mode, else the working tree against --base. */
export const changesOf = (top: string, staged: boolean, base: string | undefined): Changes => (staged ? stagedChanges(top) : baseChanges(top, String(base)));

/** The state folder's apply queue and approvals. */
export const stateFiles: ApprovalIo = {
  list: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
  read: textOf,
};
