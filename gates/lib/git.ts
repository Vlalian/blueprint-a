// Read-only git helpers for gates. Throws on a failing command; gates wrap calls in failClosed.
import { execFileSync } from 'node:child_process';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function filesAt(cwd: string, ref: string): string[] {
  return git(cwd, 'ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean);
}

export function showAt(cwd: string, ref: string, path: string): string {
  return git(cwd, 'show', `${ref}:${path}`);
}
