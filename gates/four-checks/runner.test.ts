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
  it('keeps the real exit status when stdout exceeds one MiB', () => {
    const r = shellRunner('node -e "process.stdout.write(String.fromCharCode(120).repeat(2 * 1024 * 1024)); process.exitCode = 3"', process.cwd());
    expect(r.exitCode).toBe(3);
    expect(r.output.length).toBe(2 * 1024 * 1024);
  }, 60_000);
  it('runs a real command through the shell in the given directory', () => {
    const r = shellRunner('node -e "console.log(process.cwd().length > 0); process.exitCode = (2)"', process.cwd());
    expect(r).toEqual({ exitCode: 2, output: 'true\n' });
  }, 60_000);

  it("adds the given variables to this process's environment (ticket 34)", () => {
    const r = shellRunner('node -e "console.log(process.env.WORKFLOW_ENV_FILE_VAR, typeof process.env.PATH)"', process.cwd(), { WORKFLOW_ENV_FILE_VAR: 'from-the-env-file' });
    expect(r).toEqual({ exitCode: 0, output: 'from-the-env-file string\n' });
  }, 60_000);
});
