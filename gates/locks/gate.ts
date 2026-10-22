// Ticket 67: exact-byte locks. The manifest excludes itself, since a file cannot hash itself.
// Ticket 72: a lock list (config/locks.json) is configuration, DEFAULT_LOCKS without one, and a locked
// change passes only on the branch of a ticket the owner agreed (the consent core, config/consent.json).
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { agreedBranch, parseConsent } from '../consent/core.ts';
import { globToRegExp } from '../lib/glob.ts';

export interface LocksIo {
  /** Repo-relative file names, including untracked files. */
  list(): string[];
  read(path: string): string | Uint8Array | undefined;
  write(path: string, text: string): void;
  branch(): string;
}

/**
 * The lock list without a config/locks.json: the gates, their config and the files that decide how a
 * JS/TS or .NET repo builds, tests and runs CI. Docs and the code under test stay free.
 */
export const DEFAULT_LOCKS = [
  'gates/**', 'adapters/**', 'config/**', 'AGENTS.md',
  '.github/workflows/**', 'azure-pipelines.yml', '.azure-pipelines/**', '.husky/**', '.githooks/**',
  'package.json', 'package-lock.json', 'tsconfig*.json', 'vitest*.config.*', 'jest.config.*', 'stryker.config.*', 'eslint.config.*',
  'global.json', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'nuget.config', '.editorconfig', 'stryker-config.json', '**/*.runsettings',
];

const MANIFEST = join('config', 'locks.lock');
const forward = (p: string) => p.replaceAll('\\', '/');
const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

/** The configured lock list, or DEFAULT_LOCKS when the repo has none. */
export function lockList(io: Pick<LocksIo, 'read'>): string[] {
  const text = io.read(join('config', 'locks.json'));
  return text === undefined ? DEFAULT_LOCKS : JSON.parse(String(text)) as string[];
}

/** Current hashes, sorted for a stable manifest; deleted files have no entry. */
function hashes(globs: string[], io: LocksIo): Record<string, string> {
  const patterns = globs.map(globToRegExp);
  const paths = io.list().map(forward).filter((p) => p !== 'config/locks.lock' && patterns.some((r) => r.test(p))).sort();
  return Object.fromEntries(paths.flatMap((p) => {
    const text = io.read(join(...p.split('/')));
    return text === undefined ? [] : [[p, sha(text)]];
  }));
}

/** Whether the branch builds a ticket the owner agreed; without config/consent.json no ticket is. */
function agreed(io: LocksIo): boolean {
  const consent = io.read(join('config', 'consent.json'));
  return consent !== undefined && agreedBranch(io.branch(), io, parseConsent(String(consent)));
}

/** Check the lock manifest, or regenerate it when explicitly relocking. */
export function locksCommand(relock: boolean, io: LocksIo) {
  const current = hashes(lockList(io), io);
  if (relock) {
    io.write(MANIFEST, `${JSON.stringify(current, null, 2)}\n`);
    return { gate: 'locks', pass: true, changed: [] as string[] };
  }
  const previous = JSON.parse(String(io.read(MANIFEST))) as Record<string, string>;
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter((p) => previous[p] !== current[p]).sort();
  return { gate: 'locks', pass: changed.length === 0 || agreed(io), changed };
}
