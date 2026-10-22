// The consent gate's view of a change through git (ticket 72), with git itself injected: --staged
// reads the index against HEAD (a pre-commit hook), --base the working tree, untracked files
// included, against a ref (CI, or a stop hook). io.ts wires in the real git and file system.
import type { ConsentIo } from './gate.ts';

/** One git command in the repo: its exit status and stdout. */
export type GitRun = (args: string[]) => { status: number | null; stdout: string };

export interface ConsentOptions {
  staged: boolean;
  base?: string;
  branch?: string;
}

/** stdout of a git command that must succeed. */
function out(git: GitRun, args: string[]): string {
  const r = git(args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return r.stdout;
}

const names = (text: string) => text.split('\0').filter(Boolean);
/** A file at a ref (`HEAD:x`, `:x` for the index); undefined when the ref does not have it. */
const shown = (git: GitRun, spec: string) => {
  const r = git(['show', spec]);
  return r.status === 0 ? r.stdout : undefined;
};

function stagedIo(git: GitRun): Omit<ConsentIo, 'branch'> {
  return {
    changed: () => names(out(git, ['diff', '--cached', '--name-only', '-z', '--no-renames'])),
    before: (p) => shown(git, `HEAD:${p}`),
    after: (p) => shown(git, `:${p}`),
    list: () => names(out(git, ['ls-files', '-z'])),
  };
}

function baseIo(git: GitRun, file: (path: string) => string | undefined, base: string): Omit<ConsentIo, 'branch'> {
  const untracked = () => names(out(git, ['ls-files', '-z', '--others', '--exclude-standard']));
  return {
    changed: () => [...names(out(git, ['diff', '--name-only', '-z', '--no-renames', base, '--'])), ...untracked()],
    before: (p) => shown(git, `${base}:${p}`),
    after: file,
    list: () => names(out(git, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])),
  };
}

/** The change the options name; the branch is --branch, or the checked-out one. */
export function consentIo(git: GitRun, file: (path: string) => string | undefined, opts: ConsentOptions): ConsentIo {
  const io = opts.staged ? stagedIo(git) : baseIo(git, file, baseOf(opts));
  return { ...io, branch: () => opts.branch ?? out(git, ['branch', '--show-current']).trim() };
}

function baseOf(opts: ConsentOptions): string {
  if (opts.base === undefined) throw new Error('give --staged or --base <ref>');
  return opts.base;
}
