// @process-shell
// Filesystem and git wiring shared by the lock check and the only manifest writer.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LocksIo } from './gate.ts';

// The repo these gates sit in: only it is locked (another project uses its own checks).
const HOME = join(import.meta.dirname, '..', '..');
const git = (root: string, args: string[]) => {
  const r = spawnSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

export const lockRoot = () => git(process.cwd(), ['rev-parse', '--show-toplevel']).toString().trim();
const common = (root: string) => {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? resolve(r.stdout.trim()).toLowerCase() : undefined;
};
export const workflowLocks = (root: string) => {
  const own = common(HOME);
  return own !== undefined && common(root) === own;
};

const read = (root: string, path: string) => existsSync(join(root, path)) ? readFileSync(join(root, path)) : undefined;
/** A file as staged, undefined when the index has no such path; a git failure still throws. */
const indexed = (root: string, path: string) => {
  const slashed = path.replaceAll('\\', '/');
  return git(root, ['ls-files', '-z', '--cached', '--', `:(literal)${slashed}`]).length === 0 ? undefined : git(root, ['show', `:${slashed}`]);
};

export const locksIo = (root: string, staged: boolean): LocksIo => ({
  list: () => git(root, ['ls-files', '-z', ...(staged ? [] : ['--cached', '--others', '--exclude-standard'])]).toString().split('\0').filter(Boolean),
  read: (path) => staged ? indexed(root, path) : read(root, path),
  write: (path, text) => writeFileSync(join(root, path), text),
  branch: () => git(root, ['branch', '--show-current']).toString().trim(),
});
