// A test repo built once per test file and copied for each test that needs a fresh one: a copy
// runs no git process, where building one runs a dozen (the Windows load rule, ticket 29). The
// copy is a plain folder copy, so a repo that names another folder by its absolute path (a remote)
// still names the template's: point it at the copy's own.

import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A function that returns a fresh copy of the folder `build` fills, building it on the first call. */
export function templated(prefix: string, build: (dir: string) => void): () => string {
  let template: string | undefined;
  return () => {
    if (template === undefined) {
      template = mkdtempSync(join(tmpdir(), `${prefix}template-`));
      build(template);
    }
    const dir = mkdtempSync(join(tmpdir(), prefix));
    cpSync(template, dir, { recursive: true });
    return dir;
  };
}
