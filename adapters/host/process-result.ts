// A finished gh process, and its stdout only when it succeeded: a failed gh call is never read as
// an answer.

export interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** stdout, or a throw naming what failed and why (gh's stderr, the spawn error, else the exit code). */
export function ghOutput(r: ProcessResult, what: string): string {
  if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.error?.message || `exit ${r.status}`).trim()}`);
  return r.stdout;
}
