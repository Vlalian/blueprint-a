// The supply-chain gate's rules (ECC's nightly supply-chain scan, cut down to what a lockfile
// shows): every package that is new or changed in package-lock.json must carry a licence on the
// licence gate's allowlist, or have a written exception, and may run an install script only when
// it is on the install-script allowlist. The lists are in config/supply-chain.json.

import { ALLOWED_LICENCES, licenceOk } from '../licence/core.ts';

export interface LockPackage {
  name: string;
  version: string;
  license: string | undefined;
  installScript: boolean;
}

/** Package name to the reason it is allowed, from config/supply-chain.json. */
export interface Allowlist {
  licenceExceptions: Record<string, string>;
  installScripts: Record<string, string>;
}

interface LockEntry {
  name?: string;
  version?: string;
  license?: string;
  hasInstallScript?: boolean;
  link?: boolean;
}

const INSTALLED = 'node_modules/';

/** Installed packages by their path in the lockfile; the root and workspace links are left out. */
export function lockPackages(text: string): Map<string, LockPackage> {
  const packages = (JSON.parse(text) as { packages?: Record<string, LockEntry> }).packages;
  if (!packages) throw new Error('package-lock.json has no "packages" map (lockfile version 2 or later is needed)');
  const installed = Object.entries(packages).filter(([path, entry]) => path.includes(INSTALLED) && !entry.link);
  return new Map(
    installed.map(([path, e]) => [
      path,
      { name: e.name ?? path.slice(path.lastIndexOf(INSTALLED) + INSTALLED.length), version: String(e.version), license: e.license, installScript: e.hasInstallScript === true },
    ]),
  );
}

const same = (a: LockPackage | undefined, b: LockPackage) =>
  a !== undefined && a.version === b.version && a.license === b.license && a.installScript === b.installScript;

/** Packages in head that base does not have at that path with the same version, licence and install script. */
export function changedPackages(base: Map<string, LockPackage>, head: Map<string, LockPackage>): LockPackage[] {
  return [...head].filter(([path, p]) => !same(base.get(path), p)).map(([, p]) => p);
}

/** An exact name, or a `prefix*` entry. */
const listed = (list: Record<string, string>, name: string) =>
  Object.keys(list).some((entry) => (entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : entry === name));

function licenceFinding(p: LockPackage, allow: Allowlist): string | undefined {
  if (listed(allow.licenceExceptions, p.name)) return undefined;
  const id = `${p.name}@${p.version}`;
  if (!p.license) return `${id}: no licence declared and the package has no exception`;
  if (licenceOk(p.license)) return undefined;
  return `${id}: licence "${p.license}" is not on the allowlist (${ALLOWED_LICENCES.join(', ')}) and the package has no exception`;
}

function scriptFinding(p: LockPackage, allow: Allowlist): string | undefined {
  if (!p.installScript || listed(allow.installScripts, p.name)) return undefined;
  return `${p.name}@${p.version}: runs an install script and is not on the install-script allowlist`;
}

export function supplyChainFindings(changed: LockPackage[], allow: Allowlist): string[] {
  return changed.flatMap((p) => [licenceFinding(p, allow), scriptFinding(p, allow)]).filter((f): f is string => f !== undefined);
}

const fail = (problem: string): never => {
  throw new Error(`config/supply-chain.json: ${problem}`);
};

const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null && !Array.isArray(v);

function reasons(raw: unknown, key: keyof Allowlist): Record<string, string> {
  const list = (raw as Record<string, unknown>)[key];
  if (!isObject(list)) return fail(`${key} must be an object of package name to reason`);
  for (const [name, reason] of Object.entries(list)) {
    if (typeof reason !== 'string' || !reason.trim()) fail(`${key}.${name} needs a reason`);
  }
  return list as Record<string, string>;
}

/** Fails closed: anything but two objects of name to non-empty reason is an error. */
export function parseAllowlist(text: string): Allowlist {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail((e as Error).message);
  }
  return { licenceExceptions: reasons(raw, 'licenceExceptions'), installScripts: reasons(raw, 'installScripts') };
}
