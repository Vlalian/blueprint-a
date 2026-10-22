// @process-shell
// The real git and file system for the consent gate; the logic is git-io.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { consentIo, type ConsentOptions } from './git-io.ts';

const run = (root: string) => (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** A file of the working tree, undefined when it is not there. */
export const file = (root: string, path: string) => existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined;

/** A file as staged, undefined when the index has no such path; a git failure throws. */
export function indexFile(root: string, path: string): string | undefined {
  const git = (args: string[]) => {
    const r = run(root)(args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  const slashed = path.replaceAll('\\', '/');
  return git(['ls-files', '-z', '--cached', '--', `:(literal)${slashed}`]) === '' ? undefined : git(['show', `:${slashed}`]);
}

export function repoRoot(): string {
  const r = run(process.cwd())(['rev-parse', '--show-toplevel']);
  if (r.status !== 0) throw new Error('not in a git repository');
  return r.stdout.trim();
}

export const gitConsentIo = (root: string, opts: ConsentOptions) => consentIo(run(root), (path) => file(root, path), opts);
