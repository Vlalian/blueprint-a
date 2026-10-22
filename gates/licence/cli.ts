// node gates/licence/cli.ts --package <name>=<expected repo substring>…
// Before a tool is installed: its licence must be on the allowlist and its repository the one we
// meant. Reads the registry with `npm view`. Exit 0 pass, 1 fail, 2 could not run. The logic is
// in gate.ts, which also refuses any name that is not an npm package name before it gets here.

import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { emit, failClosed } from '../lib/contract.ts';
import { licenceGate } from './gate.ts';

// parseArgs runs inside failClosed, so an unknown option exits 2, never 1.
emit(
  failClosed('licence', () =>
    licenceGate(parseArgs({ options: { package: { type: 'string', multiple: true } } }).values, {
      npmView: (name) => execSync(`npm view ${name} license repository.url name --json`, { encoding: 'utf8' }),
    }),
  ),
);
