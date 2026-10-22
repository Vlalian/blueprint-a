// The licence gate with its I/O passed in, so it is tested in-process (and mutation-tested);
// cli.ts only wires in `npm view`.

import type { GateResult } from '../lib/contract.ts';
import { licenceFindings, type PackageFacts } from './core.ts';

export interface LicenceIo {
  /** The stdout of `npm view <name> license repository.url name --json`. */
  npmView(name: string): string;
}

const USAGE = 'usage: licence --package <name>=<expected repo substring>…';

// npm's own rule for a package name, checked before the name reaches a shell.
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function parsePackage(arg: string): { name: string; expectRepo: string } {
  const at = arg.indexOf('=');
  if (at < 0 || at === arg.length - 1) throw new Error(USAGE);
  const name = arg.slice(0, at);
  if (!NPM_NAME.test(name)) throw new Error(`not an npm package name: "${name}"`);
  return { name, expectRepo: arg.slice(at + 1) };
}

function factsOf(name: string, view: string): PackageFacts {
  const v = JSON.parse(view) as { license?: string; 'repository.url'?: string };
  return { name, license: v.license, repository: v['repository.url'] };
}

export function licenceGate(opts: { package?: string[] }, io: LicenceIo): GateResult & { packages: PackageFacts[]; findings: string[] } {
  if (!opts.package?.length) throw new Error(USAGE);
  const checked = opts.package.map(parsePackage).map((w) => ({ expectRepo: w.expectRepo, facts: factsOf(w.name, io.npmView(w.name)) }));
  const findings = licenceFindings(checked);
  return { gate: 'licence', pass: findings.length === 0, packages: checked.map((c) => c.facts), findings };
}
