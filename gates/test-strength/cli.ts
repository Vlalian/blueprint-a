// node gates/test-strength/cli.ts <crap|mutation> [--runner vitest|jest|karma|dotnet] [--cwd <dir>]
//   [--coverage <coverage-final.json|coverage.cobertura.xml>] [--ceiling <n>] <path...>
// The CRAP and mutation gates through the adapter the runner names: adapters/js-ts for vitest,
// Jest and Karma, adapters/dotnet for dotnet. Paths are relative to --cwd, the project folder.
// Exit 0 pass, 1 fail, 2 could not run. The logic is in gate.ts and the adapters; this shell only
// wires them together.

import { dotnetAdapter } from '../../adapters/dotnet/adapter.ts';
import { dotnetIo } from '../../adapters/dotnet/io.ts';
import { jsTsAdapter } from '../../adapters/js-ts/adapter.ts';
import { jsTsIo } from '../../adapters/js-ts/io.ts';
import { emit, failClosed } from '../lib/contract.ts';
import { testStrengthGate } from './gate.ts';

emit(
  failClosed('test-strength', () =>
    testStrengthGate(process.argv.slice(2), (options) => (options.runner === 'dotnet' ? dotnetAdapter(options, dotnetIo(options.cwd)) : jsTsAdapter(options, jsTsIo(options.cwd)))),
  ),
);
