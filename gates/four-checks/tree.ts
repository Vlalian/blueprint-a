// The tree a worktree's checks judge (ticket 37, cache.ts): `git write-tree` of the worktree as it
// is on disk, untracked files included and ignored files left out, written through a copy of the
// index so the real index and its lock are never touched. The same copy gives the worktree's diff
// against HEAD, untracked files included, that the Stop gate judges for debug leftovers (ticket
// 47). A shell over git; cache.ts and gates/debug-leftovers decide.

import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';

function gitOut(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/**
 * The copy keeps the index's mtime: git re-reads a file whose mtime is not older than its index
 * ("racily clean"), and a copy stamped now would let a same-size edit made in the second the index
 * was written pass as unchanged. A missing index (nothing added yet) leaves the copy missing too,
 * which git reads as empty.
 */
function copyIndex(index: string, to: string): void {
  try {
    cpSync(index, to, { preserveTimestamps: true });
  } catch {}
}

/** git `last` on a copy of the index with every file of the worktree added. */
function throughCopy(cwd: string, index: string, last: string[]): string | undefined {
  const temp = `${index}.workflow-tree-${process.pid}`;
  copyIndex(index, temp);
  const env = { ...process.env, GIT_INDEX_FILE: temp };
  try {
    return gitOut(cwd, ['add', '-A'], env) === undefined ? undefined : gitOut(cwd, last, env);
  } finally {
    rmSync(temp, { force: true });
  }
}

/** git `last` on the worktree as it is on disk; undefined when the folder is not in a git repo or git fails. */
function onWorktree(cwd: string, last: string[]): string | undefined {
  const index = gitOut(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  return index === undefined ? undefined : throughCopy(cwd, index, last);
}

/** The worktree's tree hash, or undefined when the folder is not in a git repo. */
export const worktreeTree = (cwd: string): string | undefined => onWorktree(cwd, ['write-tree']);

/** The worktree's `git diff -U0` against a commit (HEAD by default), untracked files included; undefined when git gives none (no repo, no commit). */
export const worktreeDiff = (cwd: string, ref = 'HEAD'): string | undefined => onWorktree(cwd, ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', ref]);
