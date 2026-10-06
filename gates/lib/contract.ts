// The contract every gate follows: a JSON result on stdout and an exit code.
// 0 = pass, 1 = fail, 2 = the gate could not run (usage error, missing input, crash).
// A gate that cannot run never passes.

export interface GateResult {
  gate: string;
  pass: boolean;
  error?: string;
  [detail: string]: unknown;
}

export type Gate = () => GateResult;

export function exitCodeFor(result: GateResult): 0 | 1 | 2 {
  if (result.error !== undefined) return 2;
  return result.pass ? 0 : 1;
}

export function failClosed(name: string, gate: Gate): GateResult {
  try {
    return gate();
  } catch (e) {
    return { gate: name, pass: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Sets the exit code instead of calling process.exit(): exiting right after a write to a piped
// stdout crashes Node on Windows (libuv assertion, exit 0xC0000409). Every CLI calls emit last.
export function emit(result: GateResult): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = exitCodeFor(result);
}
