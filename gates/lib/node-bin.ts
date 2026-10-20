// The command that runs a package's bin as `node <its JS entry>`, resolved from a project the
// way Node resolves it (so a hoisted node_modules works too). npx and npm are .cmd shims on
// Windows, which spawnSync and execFileSync cannot start without a shell: the call returns a
// null status or ENOENT. A shell would start them, but it joins the arguments unquoted, so a
// path with a space breaks. process.execPath plus the entry file needs neither.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const BINS = {
  vitest: ['vitest', 'vitest.mjs'],
  stryker: ['@stryker-mutator/core', 'bin/stryker.js'],
  tsc: ['typescript', 'bin/tsc'],
} as const;

export function binCommand(projectDir: string, tool: keyof typeof BINS, args: string[]): [string, string[]] {
  const [pkg, entry] = BINS[tool];
  const manifest = createRequire(join(projectDir, 'package.json')).resolve(`${pkg}/package.json`);
  return [process.execPath, [join(dirname(manifest), entry), ...args]];
}
