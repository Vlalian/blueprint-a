// Keeps the red check's temporary worktree folder out of `git status` without committing a
// .gitignore change: it goes in the local .git/info/exclude instead.

import { posix } from 'node:path';

const slash = (p: string) => p.split('\\').join('/');
const isAbsolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:\//.test(p);

/** The info/exclude file for a repo, given what `git rev-parse --git-common-dir` printed. */
export function excludeFile(cwd: string, gitDir: string): string {
  const dir = slash(gitDir);
  return posix.join(isAbsolute(dir) ? dir : posix.join(slash(cwd), dir), 'info', 'exclude');
}

export interface ExcludeIo {
  /** The file's text, or undefined when it does not exist. */
  read(path: string): string | undefined;
  makeDir(path: string): void;
  write(path: string, text: string): void;
}

/** Lists the temp folder in the exclude file, creating its folder first; writes only when needed. */
export function ensureTempDirExcluded(exclude: string, io: ExcludeIo): void {
  io.makeDir(posix.dirname(exclude));
  const next = excludeWithTempDir(io.read(exclude));
  if (next !== undefined) io.write(exclude, next);
}

/** The exclude file's new text with the temp folder listed, or undefined when it already is. */
export function excludeWithTempDir(current: string | undefined): string | undefined {
  const text = current ?? '';
  return text.includes('/.red-check/') ? undefined : `${text}\n/.red-check/\n`;
}
