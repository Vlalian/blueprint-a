// What an agent may not do with git and gh (tier 4 plus the AFK git guard, ECC's no-verify
// rules and pstack's never-force-push rule). One simple command at a time, as split by
// shell-parse.ts; returns why it is blocked, or undefined when it is allowed.

import { program } from './shell-parse.ts';

export interface GitContext {
  /** The branch checked out in the session's working directory. */
  currentBranch: string;
}

type Rule = (args: string[], branch: string) => string | undefined;

const PROTECTED_BRANCHES = ['main', 'master'];
// git reads a push destination `heads/main` as `refs/heads/main`, so both prefixes name the branch.
const PROTECTED_REFS = new Set(PROTECTED_BRANCHES.flatMap((b) => [b, `heads/${b}`, `refs/heads/${b}`]));
const HOOK_RUNNING = new Set(['commit', 'merge', 'rebase', 'cherry-pick', 'am', 'push']);
// git's global options that take the next word as their value (`git --git-dir x push`).
const GLOBALS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source']);
// Config that disables hooks, renames commands or drops a safety net, whether set with
// `git -c`, `--config-env` or `git config`.
const CONFIG_RULES: Array<[RegExp, string]> = [
  [/core\.hookspath/i, 'changing core.hooksPath is not allowed'],
  [/(?:^|=)alias\./i, 'defining a git alias is not allowed; it can hide a blocked command'],
  [/clean\.requireforce/i, 'clean -f is not allowed; it deletes untracked work'],
];
// Pathspecs that name the whole tree, from the top or from the current folder.
const ALL_PATHS = new Set(['.', './', '..', '../', ':/', '*']);
const PR_API = /\/pulls\/[^/]+\/merge|mergePullRequest|markPullRequestReadyForReview|enablePullRequestAutoMerge/i;

/** git's global options before the subcommand, and where the subcommand starts. */
function splitGlobals(args: string[]): { globals: string[]; rest: string[] } {
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) i += GLOBALS_WITH_VALUE.has(args[i]!) ? 2 : 1;
  return { globals: args.slice(0, i), rest: args.slice(i) };
}

const hasShort = (args: string[], letter: string) => args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(letter));
/** git takes any unambiguous prefix of a long option (`--no-ver`, `--forc`), so a prefix counts. */
const hasLong = (args: string[], option: string) => args.some((a) => a.length > 2 && option.startsWith(a.split('=')[0]!));

function configReason(words: string[]): string | undefined {
  return CONFIG_RULES.find(([pattern]) => words.some((w) => pattern.test(w)))?.[1];
}

const isForcePush = (args: string[]) =>
  // `--force` needs no entry of its own: each prefix of it is a prefix of `--force-with-lease`.
  ['--force-with-lease', '--mirror'].some((o) => hasLong(args, o)) || hasShort(args, 'f') || args.some((a) => a.startsWith('+'));
const isDeletePush = (args: string[]) =>
  ['--delete', '--prune'].some((o) => hasLong(args, o)) || hasShort(args, 'd') || args.some((a) => a.startsWith(':'));

/** The ref a refspec pushes to: its destination, with HEAD and @ read as the current branch. */
function destination(refspec: string, branch: string): string {
  const name = refspec.split(':').at(-1)!;
  return name === 'HEAD' || name === '@' ? branch : name;
}

function targetReason(args: string[], branch: string): string | undefined {
  const refs = args.filter((a) => !a.startsWith('-')).slice(1);
  // A wildcard refspec (`refs/heads/*`) matches main too.
  const target = refs.map((r) => destination(r, branch)).find((r) => PROTECTED_REFS.has(r) || r.includes('*'));
  if (target) return `push to ${target} is not allowed; push the ticket branch and open a draft PR`;
  return refs.length === 0 && PROTECTED_BRANCHES.includes(branch) ? `push to ${branch} is not allowed; you are on ${branch}` : undefined;
}

function pushReason(args: string[], branch: string): string | undefined {
  if (isForcePush(args)) return 'force push is never allowed';
  if (isDeletePush(args)) return 'deleting a remote branch is not allowed';
  if (hasLong(args, '--all') || hasLong(args, '--branches')) return 'pushing every branch is not allowed; it pushes main too';
  return targetReason(args, branch);
}

function branchReason(args: string[]): string | undefined {
  const deletes = hasShort(args, 'd') || hasLong(args, '--delete');
  const forces = hasShort(args, 'f') || hasLong(args, '--force');
  return hasShort(args, 'D') || (deletes && forces) ? 'force-deleting a branch is not allowed' : undefined;
}

/** checkout/restore/switch over the whole tree, or with --force, throws away uncommitted work. */
function discardReason(args: string[]): string | undefined {
  const all = args.some((a) => ALL_PATHS.has(a));
  const forced = hasShort(args, 'f') || hasLong(args, '--force') || hasLong(args, '--discard-changes');
  return all || forced ? 'discarding all changes is not allowed' : undefined;
}

// A Map, not an object literal: `git constructor` must not find Object's own keys.
const SUBCOMMAND_RULES = new Map<string, Rule>([
  ['push', pushReason],
  ['config', configReason],
  ['reset', (args) => (hasLong(args, '--hard') ? 'reset --hard is not allowed; it destroys work' : undefined)],
  ['clean', (args) => (hasShort(args, 'f') || hasLong(args, '--force') ? 'clean -f is not allowed; it deletes untracked work' : undefined)],
  ['branch', branchReason],
  ['checkout', discardReason],
  ['restore', discardReason],
  ['switch', discardReason],
]);

function hooksReason(sub: string, args: string[]): string | undefined {
  const skips = hasLong(args, '--no-verify') || (sub === 'commit' && hasShort(args, 'n'));
  return HOOK_RUNNING.has(sub) && skips ? 'skipping git hooks (--no-verify) is not allowed' : undefined;
}

// gh api options, read so that anything unclear counts as a write. A method option, alone or at
// the end of a group of switches (`-X PUT`, `-XPUT`, `-iX PUT`, `--method=PUT`), and a body option
// (`-f`, `-F`, `--field`, `--raw-field`, `--input`, glued to their value or not).
const API_METHOD = /^(?:-[a-zA-Z]*X|--method)=?(.*)/;
const API_BODY = /^(?:-[a-zA-Z]*[fF]|--(?:raw-)?field|--input)/;
// What makes a GraphQL call write, or unreadable: a mutation, a body from a file, or a field from a file or stdin.
const GRAPHQL_WRITE = /\bmutation\b|^--input|=@/i;

/** The methods a gh api call names; a method option with nothing after it names "undefined". */
const apiMethods = (args: string[]) => args.flatMap((a, i) => API_METHOD.exec(a)?.slice(1).map((m) => String(m || args[i + 1])) ?? []);

/** Why a gh api call writes: any method but GET, and for REST any body. GraphQL is always POST, and reads unless its query is a mutation. */
function apiReason(args: string[]): string | undefined {
  const graphql = args[0] === 'graphql';
  const reads = graphql ? /^(?:GET|POST)$/i : /^GET$/i;
  const write = 'gh api may only read; writing through the API is not allowed';
  if (apiMethods(args).some((m) => !reads.test(m))) return write;
  if (graphql) return args.some((a) => GRAPHQL_WRITE.test(a)) ? 'a GraphQL mutation, or a query read from a file or stdin, may write; gh api may only read' : undefined;
  return args.some((a) => API_BODY.test(a)) ? write : undefined;
}

// gh takes flags anywhere (`gh pr -R o/r merge 12`), so a verb is looked for, not indexed.
const GH_RULES: Array<[(args: string[]) => boolean, string]> = [
  [(args) => args[0] === 'pr' && args.includes('merge'), "merging is the owner's call (tier 4)"],
  [(args) => args[0] === 'pr' && args.includes('ready'), "marking a PR ready is the owner's call (tier 4)"],
  [(args) => args[0] === 'api' && args.some((a) => PR_API.test(a)), "merging or readying a PR through the API is the owner's call (tier 4)"],
  [(args) => args[0] === 'alias', 'defining a gh alias is not allowed; it can hide a blocked command'],
];

function ghReason(args: string[]): string | undefined {
  const reason = GH_RULES.find(([applies]) => applies(args))?.[1];
  return reason ?? (args[0] === 'api' ? apiReason(args.slice(1)) : undefined);
}

function gitReason(args: string[], branch: string): string | undefined {
  const { globals, rest } = splitGlobals(args);
  // undefined for a bare `git`, which matches no rule.
  const sub = rest[0]!;
  const subArgs = rest.slice(1);
  return configReason(globals) ?? hooksReason(sub, subArgs) ?? SUBCOMMAND_RULES.get(sub)?.(subArgs, branch);
}

// Env names that hook managers and git read to skip or move the hooks: husky, lefthook, the
// pre-commit framework's SKIP, any *SKIP* or *NO_VERIFY* switch, and git's GIT_CONFIG_* (config
// from the environment, which can set core.hooksPath).
const HOOK_ENV_NAME = String.raw`(?:HUSKY|LEFTHOOK|\w*SKIP\w*|GIT_CONFIG\w*|\w*NO_VERIFY\w*)`;
// Set as `NAME=…` (a prefix, env, export, cmd's set) or named as PowerShell's `$env:NAME`/`env:NAME`;
// core.hooksPath in any word, however it is set.
const HOOK_ENV = new RegExp(String.raw`^(?:\$?env:${HOOK_ENV_NAME}(?:=|$)|${HOOK_ENV_NAME}=)|core\.hookspath`, 'i');

/** Why a command line's words set something that turns the git hooks off; every word counts, at every depth. */
export function hookEnvReason(words: string[]): string | undefined {
  const word = words.find((w) => HOOK_ENV.test(w));
  return word && `${word} can turn the git hooks off; agents never set it`;
}

export function blockedReason(words: string[], ctx: GitContext): string | undefined {
  const name = program(words[0]!);
  const args = words.slice(1);
  if (name === 'gh') return ghReason(args);
  return name === 'git' ? gitReason(args, ctx.currentBranch) : undefined;
}
