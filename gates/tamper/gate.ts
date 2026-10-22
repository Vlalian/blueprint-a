// The tamper gate with its I/O passed in, so it is tested (and mutation-tested) in-process; cli.ts
// only wires in git, the file system and config/tamper.json. Two modes:
// - --base <ref>: the Stop gate's check. The working tree, staged or not, against the commit before
//   the role, and the hooks against the fingerprint the harness took then.
// - --staged: the pre-commit hook's check. The staged files against HEAD, and every hook but
//   pre-commit itself against the fingerprint taken when it was installed.

import type { GateResult } from '../lib/contract.ts';
import { hooksFingerprint, tamperProblems, type ApprovalIo, type HookFile, type TamperException } from './core.ts';

export interface TamperIo extends ApprovalIo {
  /** config/tamper.json's protected globs. */
  protectedPaths: string[];
  /** Who alone changes a protected path, for the message. */
  owner: string;
  /** The project's exception rule, when config/tamper.json names one. */
  exception?: TamperException;
  /** The paths that differ from the base (staged ones in --staged mode), new and deleted ones included. */
  changed(): string[];
  /** The file at the base, or undefined when it did not exist there. */
  before(path: string): string | undefined;
  /** The file now (staged in --staged mode), or undefined when it is gone. */
  after(path: string): string | undefined;
  hooks(): { files: HookFile[]; hooksPath: string };
}

export interface TamperOptions {
  base?: string;
  staged: boolean;
  hooks?: string;
  state?: string;
}

export const USAGE = 'usage: tamper (--base <ref> | --staged) --hooks <fingerprint> [--state <state folder>] [--config <file>] [--cwd <dir>]';
const HOOKS_PROBLEM = 'the hooks or core.hooksPath differ from the base; agents never change the hooks';

function checked(opts: TamperOptions): string {
  const oneMode = Boolean(opts.base) !== opts.staged;
  if (!oneMode || !opts.hooks) throw new Error(USAGE);
  return opts.hooks;
}

export function tamperGate(opts: TamperOptions, io: TamperIo): GateResult & { problems: string[] } {
  const hooks = checked(opts);
  const ctx = { state: opts.state, list: io.list, read: io.read, before: io.before, after: io.after };
  const exception = (path: string) => io.exception?.(path, ctx);
  const problems = tamperProblems(io.changed(), io.protectedPaths, io.owner, exception);
  const now = io.hooks();
  // The pre-commit hook cannot hold its own fingerprint, so it fingerprints the other hooks.
  if (hooksFingerprint(now.files, now.hooksPath, ['pre-commit'].filter(() => opts.staged)) !== hooks) problems.push(HOOKS_PROBLEM);
  return { gate: 'tamper', pass: problems.length === 0, base: opts.base ?? 'HEAD', problems };
}
