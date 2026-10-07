// The lines a change adds: either what is staged for commit (`--staged`, for the pre-commit
// hook) or everything since a base ref including untracked files (`--base`, for the Stop gate).
// changedLinesFrom takes its I/O as a parameter so it is tested in-process.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addedLines, type AddedLine } from './diff.ts';
import { git } from './git.ts';

export interface ChangesIo {
  diffStaged(): string;
  diffSince(ref: string): string;
  untracked(): string[];
  /** The file's text, or undefined when it no longer exists. */
  read(file: string): string | undefined;
}

function wholeFile(file: string, text: string): AddedLine[] {
  return text.split(/\r?\n/).map((line, i) => ({ file, line: i + 1, text: line }));
}

export function changedLinesFrom(opts: { staged?: boolean; base?: string }, io: ChangesIo): AddedLine[] {
  if (opts.staged) return addedLines(io.diffStaged());
  if (!opts.base) throw new Error('give --staged or --base <ref>');
  const untracked = io.untracked().flatMap((file) => {
    const text = io.read(file);
    return text === undefined ? [] : wholeFile(file, text);
  });
  return [...addedLines(io.diffSince(opts.base)), ...untracked];
}

/** The real I/O: git and the working tree under cwd. */
export function gitChangesIo(cwd: string): ChangesIo {
  return {
    diffStaged: () => git(cwd, 'diff', '--cached', '-U0', '--no-color'),
    diffSince: (ref) => git(cwd, 'diff', '-U0', '--no-color', ref, '--'),
    untracked: () => git(cwd, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean),
    read: (file) => (existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), 'utf8') : undefined),
  };
}

export function changedLines(cwd: string, opts: { staged?: boolean; base?: string }): AddedLine[] {
  return changedLinesFrom(opts, gitChangesIo(cwd));
}
