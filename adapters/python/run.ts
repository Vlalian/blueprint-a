// @process-shell
// node adapters/python/run.ts <python arguments…>
// Runs the project's Python with these arguments, in the current folder, its output and exit code
// passed on: `node "{WORKFLOW}/adapters/python/run.ts" -m pytest -q`. It is the interpreter every
// Python gate uses (toolchain.ts: WORKFLOW_PYTHON, else the nearest .venv at or above the folder,
// else python3 or python on PATH), so a role command and a gate never run two different Pythons,
// and a command run from the red check's base checkout still finds the worktree's .venv. No Python
// is exit 2 with what to install (ticket 99).

import { spawnSync } from 'node:child_process';
import { realToolchain } from './io.ts';
import { runWithPython } from './toolchain.ts';

process.exitCode = runWithPython(
  process.argv.slice(2),
  realToolchain(process.cwd()),
  (command, args) => spawnSync(command, args, { stdio: 'inherit' }).status,
  (text) => process.stderr.write(text),
);
