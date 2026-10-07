// node gates/test-deletion/cli.ts --base <ref> [--allow <file | file::title>]… [--cwd <dir>]
// Fails when a test that existed at <ref> is gone from the working tree and the plan did not
// list it. Exit 0 pass, 1 fail, 2 could not run. The logic is in gate.ts.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { filesAt, showAt } from '../lib/git.ts';
import { testDeletionGate } from './gate.ts';

const { values } = parseArgs({
  options: { base: { type: 'string' }, allow: { type: 'string', multiple: true, default: [] }, cwd: { type: 'string' } },
});
const cwd = values.cwd ?? process.cwd();

emit(
  failClosed('test-deletion', () =>
    testDeletionGate(values, {
      filesAt: (ref) => filesAt(cwd, ref),
      showAt: (ref, path) => showAt(cwd, ref, path),
      readHead: (path) => (existsSync(join(cwd, path)) ? readFileSync(join(cwd, path), 'utf8') : undefined),
    }),
  ),
);
