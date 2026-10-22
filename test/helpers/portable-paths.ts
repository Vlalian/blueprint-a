// Paths in test fakes that hold on Windows too. The code under test builds paths with join, which gives '\'
// there; a fake that matches `${dir}/` finds nothing (ticket 53). These compare both forms as '/'.

import { join, sep } from 'node:path';

/** `path` with each separator turned into '/'. */
export const toSlashes = (path: string, separator = sep) => path.split(separator).join('/');

/** The parts joined as the code joins them, written with '/', as a test writes a key by hand. */
export const slashed = (...parts: string[]) => toSlashes(join(...parts));

/** The keys inside the folder `dir`, relative to it and written with '/', or only its own files when `direct`. */
export function namesUnder(keys: Iterable<string>, dir: string, direct = false, separator = sep): string[] {
  const top = toSlashes(dir, separator).concat('/');
  return [...keys]
    .map((key) => toSlashes(key, separator))
    .filter((key) => key.startsWith(top))
    .map((key) => key.slice(top.length))
    .filter((name) => !direct || !name.includes('/'));
}
