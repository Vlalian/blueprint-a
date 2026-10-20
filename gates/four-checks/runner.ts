import { spawnSync } from 'node:child_process';
import type { EnvRunner } from './env-file.ts';

const TEN_MINUTES = 10 * 60 * 1000;

interface SpawnFacts {
  status: number | null;
  stdout: string | null;
  stderr: string | null;
  error?: Error;
}

/** A finished process as the gate sees it: no status (killed, timed out) counts as exit 1. */
export function runResult(r: SpawnFacts): { exitCode: number; output: string } {
  const error = r.error ? `\n${r.error.message}` : '';
  return { exitCode: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}${error}` };
}

/** A check through the shell in `cwd`, with `env` added to this process's environment (the worktree's env file, ticket 34). */
export const shellRunner = (command: string, cwd: string, env: Record<string, string> = {}): ReturnType<EnvRunner> =>
  // Stryker disable next-line StringLiteral: equivalent; without an encoding spawnSync returns Buffers, which runResult's template literal decodes as UTF-8, the same text
  runResult(spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: TEN_MINUTES, env: { ...process.env, ...env } }));
