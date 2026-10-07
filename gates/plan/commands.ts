// Command allowlist: a plan is untrusted input (from the AFK flow's ECC comparison). Any shell
// command it tells the build to run must be a test, lint or typecheck command; anything else, and
// anything chained onto an allowed command, is refused. A project that wants its build run adds
// it with --allow (group-2 decision 42).

import type { PlanFinding } from './lint.ts';

export const DEFAULT_ALLOW = ['npm test', 'npm run lint', 'npm run typecheck', 'npx tsc --noEmit', 'npx vitest run'];

// Fence tags that hold commands; an untagged fence is read as commands too.
const SHELL_TAGS = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'pwsh', 'console', 'cmd', 'bat']);
const FENCE = /^```\s*(\S*)/;
const COMMAND_WORDS = /^(?:npm|npx|node|git|rm|curl|wget|pnpm|yarn|bun|bash|sh|powershell|pwsh|del|rmdir|chmod|sudo)\b/;
// `&&` and `||` are caught by `&` and `|`; a redirection writes a file, so it is refused too.
const CHAINING = /[;&|`<>]|\$\(/;

interface Fenced {
  /** Lines inside shell fences. */
  shell: string[];
  /** Inline code outside every fence that starts with a command word. */
  inline: string[];
}

const inlineCommands = (line: string) =>
  [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim()).filter((c) => COMMAND_WORDS.test(c));

/** Sorts each line of the plan: inside a shell fence, inside another fence, or outside. */
function sortLines(plan: string): Fenced {
  const out: Fenced = { shell: [], inline: [] };
  // undefined outside a fence; inside one, whether it is a shell fence.
  let shell: boolean | undefined;
  for (const line of plan.split(/\r?\n/)) {
    const fence = FENCE.exec(line);
    if (fence) shell = shell === undefined ? SHELL_TAGS.has(fence[1]!.toLowerCase()) : undefined;
    else if (shell === undefined) out.inline.push(...inlineCommands(line));
    else if (shell) out.shell.push(line);
  }
  return out;
}

export function commandsIn(plan: string): string[] {
  const { shell, inline } = sortLines(plan);
  return [...shell.map((l) => l.trim()).filter(Boolean), ...inline];
}

// What may follow an allowed command (decision 42): test file paths inside the repo and `-t <name>`,
// after an optional `--` for npm to pass them on. A config file, a reporter or any other flag can
// run code of the plan's choosing, so it is refused.
const ARGUMENT = /"[^"]*"|'[^']*'|\S+/g;
const TEST_PATH = /^[\w.][\w./\\-]*\.(?:test|spec)\.[cm]?[jt]sx?$/;
// A test name: quoted (no expansion inside double quotes) or one bare word that is not a flag.
// ARGUMENT already ends a quoted argument at its closing quote, so none holds another quote.
const TEST_NAME = /^(?:"[^$\\]*"|'.*'|\w[\w.:-]*)$/;

const isTestPath = (arg: string) => TEST_PATH.test(arg) && !arg.split(/[\\/]/).includes('..');

function testArguments(args: string[]): boolean {
  if (args.length === 0) return true;
  const [first, ...rest] = args;
  if (first === '-t') return rest.length > 0 && TEST_NAME.test(rest[0]!) && testArguments(rest.slice(1));
  return isTestPath(first!) && testArguments(rest);
}

/** The arguments after an allowed command: none, or test paths and -t names after an optional --. */
function argumentsAllowed(after: string): boolean {
  const args = after.match(ARGUMENT) ?? [];
  return testArguments(args[0] === '--' ? args.slice(1) : args);
}

const allowed = (command: string, allow: string[]) =>
  !CHAINING.test(command) && allow.some((a) => command === a || (command.startsWith(`${a} `) && argumentsAllowed(command.slice(a.length))));

export function commandFindings(commands: string[], allow: string[]): PlanFinding[] {
  return commands.filter((c) => !allowed(c, allow)).map((c) => ({ message: `command not on the allowlist: ${c}` }));
}
