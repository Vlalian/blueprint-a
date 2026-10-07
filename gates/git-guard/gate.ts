// The git guard as a gate (ticket 20): a command line in, the git and gh rules out
// (adapters/claude-code/git-rules.ts: no force push, no push to a protected branch, no hook
// bypass, no merge or ready by an agent, ...), so a harness without Claude Code's pre-tool hook
// can ask before it runs a shell command. Every simple command in the line counts, at every depth
// (shell-parse.ts); a line too deep to read throws, and a gate that cannot run never passes.

import { parseArgs } from 'node:util';
import { blockedReason, hookEnvReason } from './git-rules.ts';
import { readLine, type Dialect } from './shell-parse.ts';
import type { GateResult } from '../lib/contract.ts';

const USAGE = 'usage: git-guard --branch <checked-out branch> [--dialect sh|powershell|cmd] <command line>';
const DIALECTS: string[] = ['sh', 'powershell', 'cmd'];

export function gitGuard(args: string[]): GateResult {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { branch: { type: 'string' }, dialect: { type: 'string', default: 'sh' } } });
  const [line] = positionals;
  if (values.branch === undefined || line === undefined || !DIALECTS.includes(values.dialect)) throw new Error(USAGE);
  const { commands, words } = readLine(line, values.dialect as Dialect);
  const env = hookEnvReason(words);
  const blocked = [
    ...(env === undefined ? [] : [{ command: line, reason: env }]),
    ...commands.flatMap((words) => {
      const reason = blockedReason(words, { currentBranch: values.branch! });
      return reason === undefined ? [] : [{ command: words.join(' '), reason }];
    }),
  ];
  return { gate: 'git-guard', pass: blocked.length === 0, blocked };
}
