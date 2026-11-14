// How a CLI is started (moved from dispatcher/build.ts in ticket 95): the Claude Code CLI's path,
// and a JS entry run under node, so no .cmd shim or shell is needed on Windows.
import { posix } from 'node:path';

/** The Claude Code CLI: CLAUDE_CLI if set, else the npm install (native exe, then cli.js), else ''. */
export function resolveClaudeCli(env: Record<string, string | undefined>, exists: (path: string) => boolean): string {
  if (env.CLAUDE_CLI) return env.CLAUDE_CLI;
  const npm = posix.join(env.APPDATA ?? '', 'npm/node_modules/@anthropic-ai/claude-code');
  return [posix.join(npm, 'bin/claude.exe'), posix.join(npm, 'cli.js')].find(exists) ?? '';
}

/** A JS entry (.js, .mjs, .cjs, in any case) runs under node; an exe runs directly. */
export function claudeCommand(cli: string, args: string[], node: string): [string, string[]] {
  return /\.[cm]?js$/i.test(cli) ? [node, [cli, ...args]] : [cli, args];
}
