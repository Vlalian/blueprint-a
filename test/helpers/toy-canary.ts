// A throwaway repo for canary tests: one toy gate under gates/toy, proved by a real prove-it-bites
// test, with this repo's node_modules linked in so a nested vitest runs there. With `toothless` the
// toy gate's injected fault no longer fails, so the canary must turn red.

import { mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../..');

export function toyCanaryRoot(): { root: string; toothless: string } {
  const root = mkdtempSync(join(tmpdir(), 'toy-canary-'));
  const toothless = join(root, 'TOOTHLESS');
  const helper = pathToFileURL(join(ROOT, 'test', 'helpers', 'prove-it-bites.ts')).href;
  mkdirSync(join(root, 'gates', 'toy'), { recursive: true });
  mkdirSync(join(root, 'node_modules'));
  for (const e of readdirSync(join(ROOT, 'node_modules'), { withFileTypes: true })) {
    if (e.isDirectory()) symlinkSync(join(ROOT, 'node_modules', e.name), join(root, 'node_modules', e.name), 'junction');
  }
  writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(root, 'vitest.config.ts'), "export default { test: { include: ['gates/**/*.test.ts'] } };\n");
  writeFileSync(
    join(root, 'gates', 'toy', 'bites.test.ts'),
    `import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { BITES, proveItBites } from ${JSON.stringify(helper)};

it('the toy gate bites', () => {
  let broken = false;
  const run = () => (broken && !existsSync(${JSON.stringify(toothless)}) ? 1 : 0);
  expect(proveItBites({ run, inject: () => void (broken = true), revert: () => void (broken = false) })).toEqual(BITES);
});
`,
  );
  return { root, toothless };
}
