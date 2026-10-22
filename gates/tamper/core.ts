// The tamper gate (decision 34): the deterministic backstop behind a pre-tool hook, which cannot
// see what an interpreter writes (`node -e "fs.writeFileSync('CONTEXT.md', '')"`). It fails when a
// protected path or the hooks differ from the base. Its configuration (config/tamper.json, ticket
// 82) names the protected globs, the owner, the files to fingerprint as hooks (git's hooks folder
// when it names none) and optionally a module whose rule lets some protected changes through, as
// this repo's apply-lesson rule does for a lesson the owner accepted.
// There is no switch to skip it: no env var, no option. Pure; gate.ts, io.ts and cli.ts do the I/O.

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import ts from 'typescript';
import { globToRegExp } from '../lib/glob.ts';

export interface HookFile {
  name: string;
  text: string;
}

/** What the state folder holds, for an exception rule that reads approvals there. */
export interface ApprovalIo {
  /** File names directly inside dir; [] when it does not exist. */
  list(dir: string): string[];
  /** The file's text, or undefined when it does not exist. */
  read(path: string): string | undefined;
}

/** What an exception rule may read about one change. */
export interface ExceptionContext extends ApprovalIo {
  /** The state folder (--state), when one was given. */
  state?: string;
  before(path: string): string | undefined;
  after(path: string): string | undefined;
}

/**
 * A project's rule for protected changes it lets through: undefined when the rule does not cover
 * the path (it is judged as any protected path), `{}` when the change is let through, and
 * `{ problem }` when the rule covers the path and refuses the change.
 */
export type TamperException = (path: string, ctx: ExceptionContext) => { problem?: string } | undefined;

export interface TamperConfig {
  /** The globs of the paths only the owner changes. */
  protectedPaths: string[];
  owner: string;
  /** The files or folders to fingerprint as hooks, relative to the repo; undefined: git's hooks folder. */
  hooks?: string[];
  /** The exception module, as a path from the config file's folder; it exports `tamperException`. */
  exceptions?: string;
  /** The tiers file whose tier 4 holds protected globs, as a path from the config file's folder. */
  tiers?: string;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const ignored = (name: string, ignore: string[]) => ignore.some((i) => name === i || name.endsWith(`/${i}`));

/** One fingerprint for what runs as hooks: each hook file but git's samples and the ignored ones (by name), and core.hooksPath. */
export function hooksFingerprint(files: HookFile[], hooksPath: string, ignore: string[]): string {
  const kept = files.filter((f) => !f.name.endsWith('.sample') && !ignored(f.name, ignore));
  return sha(JSON.stringify([hooksPath, ...kept.map((f) => JSON.stringify([f.name, sha(f.text)])).sort()]));
}

/** Every protected path among the changed ones, each with why it may not change; `exception` may let one through. */
export function tamperProblems(changed: string[], protectedPaths: string[], owner: string, exception: (path: string) => { problem?: string } | undefined): string[] {
  const guards = protectedPaths.map(globToRegExp);
  return changed
    .filter((p) => guards.some((g) => g.test(p)))
    .flatMap((p) => {
      const verdict = exception(p);
      if (verdict === undefined) return [`${p} is tier 4 and differs from the base; only ${owner} changes it, and agents never do`];
      return verdict.problem === undefined ? [] : [`${p}: ${verdict.problem}`];
    });
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

function field<T>(c: Record<string, unknown>, key: string, ok: (v: unknown) => v is T, file: string): T | undefined {
  const v = c[key];
  if (v === undefined || ok(v)) return v;
  throw new Error(`${file}: "${key}" has the wrong type`);
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** The tier-4 globs of the tiers file, found from the config's folder; unchecked. */
const tierGlobs = (file: string, tiers: string, read: (path: string) => string | undefined): unknown =>
  (Object(JSON.parse(read(join(dirname(file), tiers)) ?? 'null')) as { tier4?: { protectedPaths?: unknown } }).tier4?.protectedPaths;

/** The protected globs: the tier-4 list of the tiers file the config names, then the config's own list; one of them at least. */
function protectedOf(c: Record<string, unknown>, file: string, tiers: string | undefined, read: (path: string) => string | undefined): string[] {
  const own = field(c, 'protectedPaths', isStrings, file);
  const lists = tiers === undefined ? [own] : [tierGlobs(file, tiers, read), own ?? []];
  if (lists.every(isStrings)) return lists.flat();
  throw new Error(`${file}: name the protected globs in "protectedPaths", or a tiers file with tier4.protectedPaths in "tiers"`);
}

/** config/tamper.json, read and checked; a missing or malformed file throws, so the gate could not run. */
export function tamperConfig(file: string, read: (path: string) => string | undefined): TamperConfig {
  const text = read(file);
  if (text === undefined) throw new Error(`no tamper config at ${file}: it names the protected paths`);
  const c = Object(JSON.parse(text)) as Record<string, unknown>;
  const owner = field(c, 'owner', isString, file) ?? 'the owner';
  const tiers = field(c, 'tiers', isString, file);
  return { protectedPaths: protectedOf(c, file, tiers, read), owner, hooks: field(c, 'hooks', isStrings, file), exceptions: field(c, 'exceptions', isString, file), tiers };
}

/** A file's path in the repo at top, '/'-separated, or undefined when it lies outside (or is the top itself). */
export function repoPath(top: string, file: string): string | undefined {
  const rel = relative(top, file);
  return rel === '' || isAbsolute(rel) || rel.split(sep)[0] === '..' ? undefined : rel.split(sep).join('/');
}

/** The shallowest folder at or above dir whose real path is top, or undefined. */
function repoRoot(dir: string, top: string, real: (path: string) => string): string | undefined {
  const parent = dirname(dir);
  const above = parent === dir ? undefined : repoRoot(parent, top, real);
  return above ?? (real(dir) === top ? dir : undefined);
}

/**
 * A file's path in the repo whose real root is top, decided by the path as written (review round 2
 * of ticket 82): only the folder that is the repo's root is resolved, nothing inside it, so a work
 * tree symlink never moves a repo file such as config/tamper.json out of the repo and off the base.
 */
export const logicalRepoPath = (top: string, file: string, real: (path: string) => string): string | undefined => {
  const root = repoRoot(dirname(file), top, real);
  return root === undefined ? undefined : repoPath(root, file);
};

/**
 * The protected globs with the policy's own files added (review round of ticket 82): a config in
 * the repo, its tiers file and its exception module are protected too, so an agent that rewrites
 * them fails the gate. The gate reads them from the base anyway; this names the change.
 */
export function policyGuarded(config: TamperConfig, configPath: string | undefined): string[] {
  if (configPath === undefined) return config.protectedPaths;
  const beside = [config.tiers, config.exceptions].filter((p) => p !== undefined).map((p) => posix.join(posix.dirname(configPath), p));
  return [...config.protectedPaths, configPath, ...beside];
}

/** The query that marks a module URL to load from the trusted revision. */
export const BASE_MARK = 'tamper-base';
const marked = (url: string | undefined) => url !== undefined && new URL(url).searchParams.has(BASE_MARK);

/** A plain relative specifier ('./x.mjs', '../y.mjs': no query, no fragment) resolved against parentURL by its path as written, or undefined. */
const plainRelative = (specifier: string, parentURL: string) => (/^\.\.?\/[^?#]*$/.test(specifier) ? new URL(specifier, parentURL).href : undefined);

/**
 * An import of a marked module (review round 3 of ticket 82, closing the class two rounds patched
 * form by form): a node: builtin is left to Node; a plain relative import that stays in the repo at
 * topUrl is marked, resolved by its path as written so a work tree symlink cannot lead it off the
 * base; any other form (a query, a fragment, an absolute path, a URL, a bare name, a way out of the
 * repo) throws, so the gate could not run.
 */
function markedImport(specifier: string, parentURL: string, topUrl: string): string | undefined {
  // node:fs reads the work tree around the base (review round 5); any other builtin is left to Node.
  if (/^node:fs(?:\/|$)/.test(specifier)) throw new Error(`the exception module imports ${JSON.stringify(specifier)}: it may not read the work tree around the base`);
  if (specifier.startsWith('node:')) return undefined;
  const url = plainRelative(specifier, parentURL);
  if (url?.startsWith(topUrl)) return `${url}?${BASE_MARK}`;
  throw new Error(`the exception module imports ${JSON.stringify(specifier)}: from the trusted base it loads only plain relative imports ('./x.mjs', '../y.mjs') and node: builtins`);
}

/** The URL an import loads from: a marked entry as it is, an import of a marked module as markedImport decides; undefined: Node resolves it. */
export function baseResolve(specifier: string, parentURL: string | undefined, topUrl: string): string | undefined {
  if (marked(parentURL)) return markedImport(specifier, parentURL!, topUrl);
  return specifier.startsWith(topUrl) && marked(specifier) ? specifier : undefined;
}

/** A call of `name` that is not a method (`x.name(` is someone else's). */
const call = (t: string[], i: number, name: string) => t[i] === name && t[i + 1] === '(' && t[i - 1] !== '.';

/**
 * What lets code reach the work tree around the loader (review round 4 of ticket 82, the owner 2026-10-21:
 * a static check, not a sandbox): the exception module is the owner's code, but it may load further
 * code only through plain static relative imports, which the loader reads from the base. Each test
 * reads the code tokens at index i.
 */
const ESCAPES: [(t: string[], i: number) => boolean, string][] = [
  [(t, i) => t[i] === 'createRequire', 'createRequire'],
  [(t, i) => call(t, i, 'require'), 'require()'],
  [(t, i) => call(t, i, 'import'), 'a dynamic import()'],
  [(t, i) => t[i] === 'process' && t[i + 1] === '.' && ['binding', 'dlopen'].includes(t[i + 2]!), 'process.binding'],
  [(t, i) => call(t, i, 'eval'), 'eval()'],
  [(t, i) => t[i] === 'new' && t[i + 1] === 'Function', 'new Function()'],
];


/** The source's code tokens, comments left out (review round 5): a word in a comment is not an escape, and a string is one token, so its words never match a name. */
function* codeTokens(source: string): Generator<string> {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) yield scanner.getTokenText();
}

/** A marked module's source at the trusted revision (`show` reads a repo path there), or undefined for an unmarked one; a marked module the base does not hold, or one that can reach the work tree around its static imports, throws, never loading from disk. */
export function baseModule(url: string, top: string, show: (path: string) => string | undefined): { format: 'module' | 'module-typescript'; source: string } | undefined {
  if (!marked(url)) return undefined;
  const rel = repoPath(top, fileURLToPath(url));
  const source = rel === undefined ? undefined : show(rel);
  if (source === undefined) throw new Error(`${rel ?? url} is not in the trusted base, so the exception module cannot load it`);
  const tokens = [...codeTokens(source)];
  const escape = ESCAPES.find(([at]) => tokens.some((_, i) => at(tokens, i)));
  if (escape !== undefined) throw new Error(`${rel} uses ${escape[1]}: the exception module and its imports may load code only through plain static relative imports`);
  return { format: rel!.endsWith('.ts') ? 'module-typescript' : 'module', source };
}

/** The exception module's rule; a module that exports no `tamperException` function throws. */
export function exceptionRule(module: { tamperException?: unknown }, name: string): TamperException {
  if (typeof module.tamperException === 'function') return module.tamperException as TamperException;
  throw new Error(`${name} exports no tamperException`);
}

/** The check the dispatcher adds to every role's Stop gate: this gate against the commit before the role. */
export function tamperCommand(o: { workflow: string; base: string; hooks: string; state: string }): string {
  return `node "${o.workflow}/gates/tamper/cli.ts" --base ${o.base} --hooks ${o.hooks} --state "${o.state}"`;
}
