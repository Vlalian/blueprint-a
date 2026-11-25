// The supply-chain gate for a Python project (ticket 99): known vulnerabilities, from pip-audit
// (PyPI's advisory database), in the packages a Python lockfile pins. uv.lock, poetry.lock and a
// fully pinned requirements file are read here, and their registry packages audited as exact pins
// (`--no-deps --disable-pip`, nothing installed); a package that is new or changed since the base
// blocks, one the base already had is reported as standing. pyproject.toml, or a requirements file
// with an unpinned line, is the fallback: pip-audit resolves it itself and every vulnerability
// blocks, since there is no pinned base to compare with. pip-audit missing, failing or offline is
// "could not run". osv-scanner is not used yet (it is a Go binary download; a follow-up of ticket 99).

import { dirname, join } from 'node:path';
import type { GateResult } from '../lib/contract.ts';
import type { Ran } from '../../adapters/python/toolchain.ts';
import { fromRef, supplyChainGate, type SupplyChainIo } from './gate.ts';

export interface PyPackage {
  name: string;
  version: string;
}

export interface PythonAuditIo extends SupplyChainIo {
  /** pip-audit from the project's Python, in the project folder; throws with its install command when missing. */
  pipAudit(args: string[]): Ran;
  tempDir(): string;
  write(path: string, text: string): void;
  remove(dir: string): void;
}

export interface PythonSupplyChainOptions {
  base?: string;
  'base-file'?: string;
  lockfile?: string;
}

export type PythonSupplyChainResult = GateResult & { changed?: string[]; findings: string[]; standing: string[]; notAudited: string[]; unpinned?: string[] };

const LOCKFILE = /(?:^|\/)(?:uv\.lock|poetry\.lock|requirements[^/]*\.txt|pyproject\.toml)$/;

/** Whether the gate reads this lockfile as a Python one. */
export const isPythonLockfile = (path: string) => LOCKFILE.test(path.split('\\').join('/'));

/** PEP 503: a distribution name compared lower case, with runs of -, _ and . as one -. */
const normalised = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

// A uv or poetry package that is not from a registry: the project itself, a path, a git checkout.
const NOT_REGISTRY = /^source = \{[^}]*\b(?:editable|virtual|directory|path|git|url) =|^type = "(?:directory|file|git|url)"/m;

/** The [[package]] blocks of uv.lock or poetry.lock, each up to the next package or top-level table. */
function lockBlocks(text: string): string[] {
  return text
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)
    .map((block) => block.split(/^\[(?!package\.)[^\]]*\]\s*$/m)[0]!);
}

const field = (block: string, key: string) => new RegExp(`^${key} = "([^"]+)"`, 'm').exec(block)?.[1];

// name, optional extras, == or ===, version; markers and hashes after it are ignored.
const PINNED = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*===?\s*([^\s;\\]+)/;

/** The pinned registry packages of a lockfile, and the requirement lines that pin nothing. */
export function pythonPackages(lockfile: string, text: string): { pinned: PyPackage[]; unpinned: string[] } {
  if (/requirements[^/]*\.txt$/.test(lockfile)) {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/(?:^|\s)#.*$/, '').trim());
    // A hash continuation line and an option (-r, --index-url, -e) are not requirements.
    const requirements = lines.filter((l) => l !== '' && !l.startsWith('-'));
    const pinned = requirements.flatMap((l) => {
      const m = PINNED.exec(l);
      return m === null ? [] : [{ name: normalised(m[1]!), version: m[2]! }];
    });
    return { pinned, unpinned: requirements.filter((l) => !PINNED.test(l)).map((l) => l.replace(/\s*\\$/, '')) };
  }
  const pinned = lockBlocks(text).flatMap((block) => {
    const name = field(block, 'name');
    const version = field(block, 'version');
    return name === undefined || version === undefined || NOT_REGISTRY.test(block) ? [] : [{ name: normalised(name), version }];
  });
  return { pinned, unpinned: [] };
}

type AuditJson = { dependencies?: Array<{ name: string; version?: string; vulns?: Array<{ id: string; fix_versions?: string[] }>; skip_reason?: string }> };

export interface Vulnerable extends PyPackage {
  ids: string[];
  fixes: string[];
}

/** pip-audit's `-f json` report: the packages with known vulnerabilities, each advisory once, and the packages it could not audit. */
export function parseAudit(stdout: string): { vulnerable: Vulnerable[]; notAudited: string[] } {
  let report: AuditJson;
  try {
    report = JSON.parse(stdout) as AuditJson;
  } catch {
    throw new Error(`pip-audit gave no JSON report: ${stdout.trim().slice(0, 500)}`);
  }
  if (!Array.isArray(report.dependencies)) throw new Error('pip-audit gave no JSON report: no "dependencies"');
  const vulnerable = report.dependencies
    .filter((d) => (d.vulns ?? []).length > 0)
    .map((d) => ({ name: normalised(d.name), version: String(d.version), ids: [...new Set(d.vulns!.map((v) => v.id))], fixes: [...new Set(d.vulns!.flatMap((v) => v.fix_versions ?? []))] }));
  const notAudited = report.dependencies.filter((d) => d.skip_reason !== undefined).map((d) => `${d.name}: ${d.skip_reason!.trim()}`);
  return { vulnerable, notAudited };
}

const describe = (v: Vulnerable) => `${v.name}@${v.version}: known vulnerabilities ${v.ids.join(', ')}${v.fixes.length === 0 ? ', no fixed version yet' : ` (fixed in ${v.fixes.join(', ')})`}`;
const OUTPUT = ['-f', 'json', '--progress-spinner', 'off'];

function audited(io: PythonAuditIo, args: string[]) {
  const ran = io.pipAudit([...args, ...OUTPUT]);
  // 0: nothing found, 1: vulnerabilities found; anything else did not audit.
  if (ran.status !== 0 && ran.status !== 1) throw new Error(`pip-audit exited ${ran.status}: ${[ran.stderr, ran.error?.message].join('\n').trim()}`);
  return parseAudit(ran.stdout);
}

/** pip-audit on exact pins, written to a temp requirements file that is always removed. */
function auditPins(pins: PyPackage[], io: PythonAuditIo) {
  if (pins.length === 0) return { vulnerable: [], notAudited: [] };
  const dir = io.tempDir();
  try {
    const file = join(dir, 'requirements.txt').split('\\').join('/');
    io.write(file, pins.map((p) => `${p.name}==${p.version}\n`).join(''));
    return audited(io, ['-r', file, '--no-deps', '--disable-pip']);
  } finally {
    io.remove(dir);
  }
}

/** pyproject.toml, or a requirements file with an unpinned line: pip-audit resolves it, every vulnerability blocking. */
function auditWhole(lockfile: string, unpinned: string[] | undefined, io: PythonAuditIo): PythonSupplyChainResult {
  const { vulnerable, notAudited } = audited(io, unpinned === undefined ? [dirname(lockfile)] : ['-r', lockfile]);
  const findings = vulnerable.map(describe);
  return { gate: 'supply-chain', pass: findings.length === 0, findings, standing: [], notAudited, ...(unpinned === undefined ? {} : { unpinned }) };
}

/** The base's lockfile: a saved file, a git ref's, or none (every package is new). */
function baseText(opts: PythonSupplyChainOptions, lockfile: string, io: PythonAuditIo): string | undefined {
  if (opts['base-file'] !== undefined) return io.readFile(opts['base-file']);
  return opts.base === undefined ? undefined : fromRef(opts.base, lockfile, io);
}

const key = (p: PyPackage) => `${p.name}@${p.version}`;

/** Exact pins: a vulnerable package new since the base blocks, one the base had is standing. */
function auditChange(opts: PythonSupplyChainOptions, lockfile: string, pinned: PyPackage[], io: PythonAuditIo): PythonSupplyChainResult {
  const before = baseText(opts, lockfile, io);
  const atBase = new Set(before === undefined ? undefined : pythonPackages(lockfile, before).pinned.map(key));
  const { vulnerable, notAudited } = auditPins(pinned, io);
  const isNew = (v: Vulnerable) => !atBase.has(key(v));
  const findings = vulnerable.filter(isNew).map(describe);
  const changed = pinned.filter((p) => !atBase.has(key(p))).map(key);
  return { gate: 'supply-chain', pass: findings.length === 0, changed, findings, standing: vulnerable.filter((v) => !isNew(v)).map(describe), notAudited };
}

export function pythonSupplyChainGate(opts: PythonSupplyChainOptions, io: PythonAuditIo): PythonSupplyChainResult {
  const lockfile = opts.lockfile ?? 'uv.lock';
  const text = io.readFile(lockfile);
  if (text === undefined) throw new Error(`no lockfile at ${lockfile}`);
  if (lockfile.endsWith('pyproject.toml')) return auditWhole(lockfile, undefined, io);
  const { pinned, unpinned } = pythonPackages(lockfile, text);
  return unpinned.length > 0 ? auditWhole(lockfile, unpinned, io) : auditChange(opts, lockfile, pinned, io);
}

/** The I/O only the Python gate needs, beside git and the files. */
export type PythonAuditExtras = Omit<PythonAuditIo, keyof SupplyChainIo>;

/** The gate a lockfile needs: the Python one (pip-audit) for a Python lockfile, the npm one otherwise. */
export function supplyChainFor(opts: PythonSupplyChainOptions & { allowlist?: string }, io: SupplyChainIo, python: () => PythonAuditExtras): GateResult {
  const isPython = opts.lockfile !== undefined && isPythonLockfile(opts.lockfile);
  return isPython ? pythonSupplyChainGate(opts, { ...io, ...python() }) : supplyChainGate(opts, io);
}
