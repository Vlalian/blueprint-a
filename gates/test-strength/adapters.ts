// Which adapter measures for each runner (contract.ts): adapters/js-ts for vitest, Jest and Karma,
// adapters/dotnet for dotnet (ticket 30), adapters/python for python (ticket 99). A table, so a new
// language is one row; cli.ts only hands it the parsed options.

import { dotnetAdapter } from '../../adapters/dotnet/adapter.ts';
import { dotnetIo } from '../../adapters/dotnet/io.ts';
import { jsTsAdapter } from '../../adapters/js-ts/adapter.ts';
import { jsTsIo } from '../../adapters/js-ts/io.ts';
import { pythonAdapter } from '../../adapters/python/adapter.ts';
import { pythonIo } from '../../adapters/python/io.ts';
import type { TestStrengthAdapter } from './contract.ts';
import type { AdapterOptions, AnyAdapterOptions, JsRunner, Runner } from './gate.ts';

const jsTs = (o: AnyAdapterOptions) => jsTsAdapter(o as AdapterOptions<JsRunner>, jsTsIo(o.cwd));

const ADAPTERS: Record<Runner, (o: AnyAdapterOptions) => TestStrengthAdapter> = {
  vitest: jsTs,
  jest: jsTs,
  karma: jsTs,
  dotnet: (o) => dotnetAdapter(o, dotnetIo(o.cwd)),
  python: (o) => pythonAdapter(o, pythonIo(o.cwd)),
};

/** The adapter the options' runner names. */
export const adapterFor = (options: AnyAdapterOptions): TestStrengthAdapter => ADAPTERS[options.runner](options);
