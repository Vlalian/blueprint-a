// Which files an onkel run grades. Kept out of cli.ts, which is exempt from mutation, so the
// decision is mutation-tested (review #22).
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from './scope.ts';

/** Repo-relative, forward slashes — the key both tools agree on. */
export function key(path: string): string {
  return relative(process.cwd(), resolve(path)).split('\\').join('/');
}

/** A source .ts file: not a test, not a declaration. `.tsx` is never graded. */
function isSource(path: string): boolean {
  return path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts');
}

/**
 * The files this run will grade, the ones it will not, and the source `.ts` paths among those
 * that do not exist: a typo, unless the diff deletes the file (decision #37).
 */
export function selectFiles(
  argv: string[],
  exists: (path: string) => boolean = existsSync,
): {
  files: string[];
  skipped: string[];
  missing: string[];
} {
  const paths = parseArgs(argv).paths.map(key);
  const sources = paths.filter(isSource);
  const files = sources.filter((p) => exists(p));
  return { files, skipped: paths.filter((p) => !files.includes(p)), missing: sources.filter((p) => !files.includes(p)) };
}

/** The missing paths the diff does not delete: onkel cannot run on a path that is not there (decision #37). */
export function unexplainedMissing(missing: string[], deleted: string[]): string[] {
  return missing.filter((p) => !deleted.includes(p));
}
