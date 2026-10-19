// Read-only git helpers for gates. Throws on a failing command; gates wrap calls in failClosed.
import { execFileSync, spawnSync } from 'node:child_process';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function filesAt(cwd: string, ref: string): string[] {
  return git(cwd, 'ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean);
}

export function showAt(cwd: string, ref: string, path: string): string {
  return git(cwd, 'show', `${ref}:${path}`);
}

/**
 * Every value a config key has in the repo at cwd (`git config --get-all`), in order; none when unset or not a repo.
 * Read with -z, each value ended by a NUL: a bare key (git's true) is an empty value, kept, not dropped as a blank line.
 */
export function configValues(cwd: string, key: string): string[] {
  return (spawnSync('git', ['config', '-z', '--get-all', key], { cwd, encoding: 'utf8' }).stdout ?? '').split('\0').slice(0, -1);
}
