// @process-shell
// node gates/test-strength/cli.ts <crap|mutation> [--runner vitest|jest|karma|dotnet|python] [--cwd <dir>]
//   [--coverage <coverage-final.json|coverage.cobertura.xml|coverage.json>] [--ceiling <n>] [--base <ref>] <path...>
// The CRAP and mutation gates through the adapter the runner names (adapters.ts): adapters/js-ts for
// vitest, Jest and Karma, adapters/dotnet for dotnet, adapters/python for python (pytest,
// coverage.py, radon, cosmic-ray). Paths are relative to --cwd, the project folder; a Python path
// may be a folder, and --base scopes Python mutants to the lines changed since that ref.
// Exit 0 pass, 1 fail, 2 could not run. The logic is in gate.ts and the adapters; this shell only
// wires them together.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emit, failClosed } from '../lib/contract.ts';
import { adapterFor } from './adapters.ts';
import { testStrengthGate } from './gate.ts';

emit(
  failClosed('test-strength', () =>
    testStrengthGate(
      process.argv.slice(2),
      adapterFor,
      // A file that is not there reads as unread, which leaves its ignored mutants unverified.
      (cwd, file) => (existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), 'utf8') : undefined),
    ),
  ),
);
