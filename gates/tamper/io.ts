// @process-shell
// The tamper gate's configuration and exception module (ticket 82): config/tamper.json beside the
// gates (or --config), and the module it names, loaded from the config file's folder. A config in
// the repo under check is read at the trusted base (the base commit, HEAD in --staged mode), with
// its tiers file, its exception module and every repo file that module imports, so a change to
// them in the working tree never changes the policy (review round), nor does a symlink there
// (review round 2). That module loads only plain relative imports and node: builtins; any other
// import form, or a file the base does not hold, makes the gate exit 2 (review round 3). Wiring
// only; the decisions are in core.ts.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE_MARK, baseModule, baseResolve, exceptionRule, logicalRepoPath, tamperConfig, type TamperConfig, type TamperException } from './core.ts';

/** config/tamper.json of the repo these gates sit in. */
export const HOME_CONFIG = join(import.meta.dirname, '..', '..', 'config', 'tamper.json');

const textOf = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

/** A file at a revision ('' for the index), or undefined when it is not there. */
export function showAt(cwd: string, rev: string, path: string): string | undefined {
  const r = spawnSync('git', ['show', `${rev}:${path}`], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : undefined;
}

/** Where the policy is read: the repo's files at the trusted revision, any other file from disk. */
export interface Trusted {
  top: string;
  rev: string;
}

const real = (path: string) => (existsSync(path) ? realpathSync(path) : path);
// Whether a file is the repo's is decided by its path as written, never through a symlink in the
// work tree, so a symlinked config/tamper.json is still read at the base (review round 2).
const inRepo = (trusted: Trusted | undefined, path: string) => (trusted === undefined ? undefined : logicalRepoPath(real(trusted.top), resolve(path), real));
const trustedText = (trusted: Trusted | undefined) => (path: string) => {
  const rel = inRepo(trusted, path);
  return rel === undefined ? textOf(path) : showAt(trusted!.top, trusted!.rev, rel);
};

export const readTamperConfig = (file: string, trusted?: Trusted): TamperConfig => tamperConfig(file, trustedText(trusted));

/** The config's path in the repo under check, or undefined when it lies outside it. */
export const configInRepo = (file: string, trusted: Trusted) => inRepo(trusted, file);

/** The hook targets of the home config, or undefined (git's hooks folder) when there is no config. */
export const homeHooks = (): string[] | undefined => (existsSync(HOME_CONFIG) ? readTamperConfig(HOME_CONFIG).hooks : undefined);

/** Serves a module URL marked BASE_MARK, and every repo file it imports, from the trusted revision. */
function serveFromBase(trusted: Trusted): void {
  const top = real(trusted.top);
  const topUrl = pathToFileURL(join(top, '/')).href;
  registerHooks({
    resolve: (specifier, context, next) => {
      const url = baseResolve(specifier, context.parentURL, topUrl);
      return url === undefined ? next(specifier, context) : { url, shortCircuit: true };
    },
    load: (url, context, next) => {
      const module = baseModule(url, top, (rel) => showAt(trusted.top, trusted.rev, rel));
      return module === undefined ? next(url, context) : { ...module, shortCircuit: true };
    },
  });
}

/** The exception module's URL: marked to load from the trusted revision when it lies in the repo. */
function moduleUrl(path: string, trusted: Trusted | undefined): string {
  const rel = inRepo(trusted, path);
  if (rel === undefined) return pathToFileURL(path).href;
  serveFromBase(trusted!);
  return `${pathToFileURL(join(real(trusted!.top), rel)).href}?${BASE_MARK}`;
}

/** The config's exception rule, or undefined when it names none. */
export const loadException = async (file: string, config: TamperConfig, trusted?: Trusted): Promise<TamperException | undefined> =>
  config.exceptions === undefined ? undefined : exceptionRule((await import(moduleUrl(resolve(dirname(file), config.exceptions), trusted))) as object, config.exceptions);
