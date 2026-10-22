// The supply-chain gate with its I/O passed in, so it is tested in-process (and mutation-tested);
// cli.ts only wires in git and the file system. The base lockfile is either a git ref's
// (`--base`, for a change) or a saved file (`--base-file`, for the dispatcher's scan once per run,
// against what the last clean scan saw).

import { failClosed, type GateResult } from '../lib/contract.ts';
import { changedPackages, lockPackages, parseAllowlist, supplyChainFindings } from './core.ts';

export interface SupplyChainOptions {
  base?: string;
  'base-file'?: string;
  lockfile?: string;
  allowlist?: string;
}

export interface SupplyChainIo {
  /** The file's text, or undefined when it does not exist. */
  readFile(path: string): string | undefined;
  git(args: string[]): { status: number | null; stdout: string };
}

export type SupplyChainResult = GateResult & { changed?: string[]; findings?: string[] };

const USAGE = 'usage: supply-chain --base <ref> | --base-file <lockfile> [--lockfile package-lock.json] [--allowlist config/supply-chain.json]';

function fromRef(ref: string | undefined, lockfile: string, io: SupplyChainIo): string | undefined {
  if (!ref) throw new Error(USAGE);
  // Arguments go to git without a shell, but git would still read a leading dash as an option.
  if (ref.startsWith('-')) throw new Error(`not a git ref: ${ref}`);
  if (io.git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status !== 0) throw new Error(`unknown git ref: ${ref}`);
  const shown = io.git(['show', `${ref}:${lockfile}`]);
  // No lockfile at the base: every package is new.
  return shown.status === 0 ? shown.stdout : undefined;
}

function required(path: string, what: string, io: SupplyChainIo): string {
  const text = io.readFile(path);
  if (text === undefined) throw new Error(`no ${what} at ${path}`);
  return text;
}

export function supplyChainGate(opts: SupplyChainOptions, io: SupplyChainIo): SupplyChainResult {
  const lockfile = opts.lockfile ?? 'package-lock.json';
  const baseFile = opts['base-file'];
  const base = baseFile === undefined ? fromRef(opts.base, lockfile, io) : io.readFile(baseFile);
  const head = lockPackages(required(lockfile, 'lockfile', io));
  const allow = parseAllowlist(required(opts.allowlist ?? 'config/supply-chain.json', 'allowlist', io));
  const changed = changedPackages(base === undefined ? new Map() : lockPackages(base), head);
  const findings = supplyChainFindings(changed, allow);
  return { gate: 'supply-chain', pass: findings.length === 0, changed: changed.map((p) => `${p.name}@${p.version}`), findings };
}

/**
 * The dispatcher's scan once per run: new or changed packages since the last clean scan. A clean
 * scan saves the lockfile as the next baseline; a failed one keeps the old baseline, so the same
 * packages are flagged again until they are allowed or removed.
 */
export function supplyChainScan(
  paths: { lockfile: string; baseline: string; allowlist: string },
  io: SupplyChainIo & { write(path: string, text: string): void },
): SupplyChainResult {
  const result = failClosed('supply-chain', () => supplyChainGate({ 'base-file': paths.baseline, lockfile: paths.lockfile, allowlist: paths.allowlist }, io));
  if (result.pass) io.write(paths.baseline, io.readFile(paths.lockfile) as string);
  return result;
}
