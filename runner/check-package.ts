// node scripts/check-package.ts <folder> [--rules <file>]
// Scans every file in a folder that is about to leave this repo (the Blueprint A package) for
// secrets, hidden Unicode, personal paths, email addresses, private names and private repository
// links. The rules default to config/package-rules.json. Exit 0 pass, 1 fail, 2 could not run.
// The logic is in check-package-core.ts; this shell only wires in the file system.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { emit, failClosed } from '../gates/lib/contract.ts';
import { checkPackage } from './check-package-core.ts';

const DEFAULT_RULES = join(import.meta.dirname, '..', 'config', 'package-rules.json');

const filesUnder = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));

emit(
  failClosed('check-package', () =>
    checkPackage(
      process.argv.slice(2),
      {
        files: filesUnder,
        read: (dir, file) => readFileSync(join(dir, file), 'utf8'),
        rules: (path) => readFileSync(path, 'utf8'),
      },
      DEFAULT_RULES,
    ),
  ),
);
