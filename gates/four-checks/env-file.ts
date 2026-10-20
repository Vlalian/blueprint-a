// The worktree's env file for the checks (ticket 34). Vitest and most tools do not load
// `.env.local` themselves, so an app test that reads DATABASE_URL failed in the checks although the
// file held it. Every role check and the Stop gate run with the variables of neon.envFile (default
// `.env.local`) added to their environment. The values are secrets: never logged, and a check's
// output (which goes into observations, block reasons and the briefing) has every value of 8 or
// more characters replaced by `[env:<name>]`; shorter values (a port, a flag) are left, since
// replacing them would garble the output. Pure; the runner that spawns is passed in.

import type { Runner } from './check.ts';

export const DEFAULT_ENV_FILE = '.env.local';

/** The env file the checks read, in the worktree: the project's neon.envFile, else .env.local. */
export const envFileOf = (config: { neon?: { envFile?: string } }) => config.neon?.envFile ?? DEFAULT_ENV_FILE;

const LINE = /^\s*([A-Za-z_]\w*)\s*=(.*)/;
const QUOTED = /^(["'])(.*)\1$/;

const unquote = (value: string) => QUOTED.exec(value)?.[2] ?? value;

/** The env file's KEY=VALUE lines; comments, blanks and lines that set nothing are skipped. */
export function parseEnvFile(text: string | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  // Stryker disable next-line StringLiteral: equivalent; any replacement text has no '=', so it parses to no variables, as '' does
  for (const line of (text ?? '').split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) vars[m[1]!] = unquote(m[2]!.trim());
  }
  return vars;
}

const REDACT_MIN = 8;

/** The output with every value of REDACT_MIN or more characters replaced by `[env:<name>]`, longest first. */
export function redact(output: string, vars: Record<string, string>): string {
  const secret = Object.entries(vars)
    .filter(([, value]) => value.length >= REDACT_MIN)
    .sort(([, a], [, b]) => b.length - a.length);
  return secret.reduce((text, [name, value]) => text.replaceAll(value, `[env:${name}]`), output);
}

/** A runner that also takes the variables to add to the command's environment. */
export type EnvRunner = (command: string, cwd: string, env: Record<string, string>) => { exitCode: number; output: string };

/** The checks' runner: each command with the env file's variables, its output without their values. */
export function withEnvFile(vars: Record<string, string>, run: EnvRunner): Runner {
  return (command, cwd) => {
    const r = run(command, cwd, vars);
    return { exitCode: r.exitCode, output: redact(r.output, vars) };
  };
}
