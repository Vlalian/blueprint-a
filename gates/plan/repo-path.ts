// Whether a path a plan names is a file inside the project (group-2 decision 46). Symlinks are
// resolved first, as ECC does before its containment test: a link inside the repo that leads out
// of it does not count, and neither does a sibling folder that only shares the repo's name.

import { resolve, sep } from 'node:path';

/** True when `path`, resolved from `repo` through every symlink, exists inside `repo`. */
export function existsInRepo(repo: string, path: string, realpath: (p: string) => string): boolean {
  try {
    const root = realpath(repo);
    return realpath(resolve(root, path)).startsWith(`${root}${sep}`);
  } catch {
    // realpath throws for a path that does not exist.
    return false;
  }
}
