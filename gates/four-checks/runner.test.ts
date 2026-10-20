import { describe, expect, it } from 'vitest';
import { runResult, shellRunner } from './runner.ts';

describe('runResult', () => {
  it('joins stdout and stderr and keeps the exit status', () => {
    expect(runResult({ status: 3, stdout: 'out\n', stderr: 'err\n' })).toEqual({ exitCode: 3, output: 'out\nerr\n' });
  });

  it('treats a process killed without a status as exit 1, and appends the spawn error', () => {
    expect(runResult({ status: null, stdout: null, stderr: null, error: new Error('spawnSync sh ETIMEDOUT') })).toEqual({
      exitCode: 1,
      output: '\nspawnSync sh ETIMEDOUT',
    });
  });
});

describe('shellRunner', () => {
  it('runs a real command through the shell in the given directory', () => {
    const r = shellRunner('node -e "console.log(process.cwd().length > 0); process.exitCode = (2)"', process.cwd());
    expect(r).toEqual({ exitCode: 2, output: 'true\n' });
  }, 60_000);

  it("adds the given variables to this process's environment (ticket 34)", () => {
    const r = shellRunner('node -e "console.log(process.env.WORKFLOW_ENV_FILE_VAR, typeof process.env.PATH)"', process.cwd(), { WORKFLOW_ENV_FILE_VAR: 'from-the-env-file' });
    expect(r).toEqual({ exitCode: 0, output: 'from-the-env-file string\n' });
  }, 60_000);
});
