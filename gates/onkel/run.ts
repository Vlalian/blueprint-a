// node gates/onkel/run.ts [--whole-file] [--base <ref>] [--exempt <path>]… [--sandbox-ignore <path>]…
//   [--incremental-file <path>] <path…>
// Exit 0 pass, 1 escalate, 2 could not run. cli.ts holds the orchestration so tests can import it.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { main } from './cli.ts';
import { exitCodeOf, toolchainProblem } from './run-core.ts';

function projectVitestVersion(): string | undefined {
  try {
    return (createRequire(join(process.cwd(), 'package.json'))('vitest/package.json') as { version: string }).version;
  } catch {
    return undefined;
  }
}

// process.exitCode, never process.exit(): the report has just gone to a stdout that is often a
// pipe, and exiting right after such a write crashes Node on Windows (exit 0xC0000409).
const problem = toolchainProblem(projectVitestVersion());
if (problem) console.error(`onkel could not run: ${problem}`);
process.exitCode = problem ? 2 : exitCodeOf(() => main());
