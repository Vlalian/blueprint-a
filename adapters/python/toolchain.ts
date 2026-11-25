// The project's Python and its tools (ticket 99), for the Python adapter and the Python parts of
// the gates. The tools are the project's dev dependencies, never the Workflow's: they are found in
// the scripts folder of the project's Python, which is WORKFLOW_PYTHON when set, else the .venv of
// the project folder or of the nearest folder above it (the red check's base checkout sits inside
// the worktree), else python3 or python on PATH. A Python older than 3.10 is passed over. The chosen
// Python is asked for its own absolute path, so a command handed to another tool (cosmic-ray's test
// command) never depends on the folder it runs in. A missing Python or tool is an error naming the
// interpreter, its version and what to install, which a gate reports as exit 2.

import { dirname, join } from 'node:path';

export type PythonTool = 'pytest' | 'coverage' | 'radon' | 'cosmic-ray' | 'bandit' | 'pip-audit' | 'lint-imports';

/** The pip requirement that installs each tool; cosmic-ray is pinned to the version proven on Windows (ticket 99). */
export const PACKAGES: Record<PythonTool, string> = {
  pytest: 'pytest',
  coverage: 'coverage>=7.10',
  radon: 'radon',
  'cosmic-ray': 'cosmic-ray==8.9.0',
  bandit: 'bandit',
  'pip-audit': 'pip-audit',
  'lint-imports': 'import-linter',
};

export const NO_PYTHON =
  'Python 3.10 or later was not found: install it (https://www.python.org/downloads/), create the project\'s .venv (`python -m venv .venv`) and install its dev tools there, or set WORKFLOW_PYTHON to its python';

export interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** What spawnSync gave back, as a Ran: no output is empty text. */
export const ranOf = (r: { status: number | null; stdout: string | null; stderr: string | null; error?: Error }): Ran => ({
  status: r.status,
  stdout: r.stdout ?? '',
  stderr: r.stderr ?? '',
  ...(r.error === undefined ? {} : { error: r.error }),
});

/**
 * What run.ts does for a role command: the project's Python (the same one every Python gate uses)
 * with these arguments, its exit code passed on; 1 when it has none (killed), 2 with the reason when
 * there is no Python to run.
 */
export function runWithPython(args: string[], tools: Pick<PythonToolchain, 'python'>, spawn: (command: string, args: string[]) => number | null, warn: (text: string) => void): number {
  try {
    return spawn(tools.python(), args) ?? 1;
  } catch (e) {
    warn(`${(e as Error).message}\n`);
    return 2;
  }
}

export interface ToolchainDeps {
  /** Starts a program with arguments in a folder, no shell, with these variables added to the environment. */
  spawn(command: string, args: string[], cwd: string, env?: Record<string, string>): Ran;
  exists(path: string): boolean;
  env: Record<string, string | undefined>;
  platform: string;
}

export interface PythonToolchain {
  /** The absolute path of the project's Python. */
  python(): string;
  /** Throws with the install command when the tool is not installed; runs nothing. */
  require(tool: PythonTool): void;
  /** Runs one of its tools in the project folder, with `env` added; throws with the install command when it is missing. */
  run(tool: PythonTool, args: string[], env?: Record<string, string>): Ran;
}

const PROBE = 'import sys, sysconfig; print(sys.executable); print(sysconfig.get_path("scripts")); print(".".join(map(str, sys.version_info[:3])))';

interface Found {
  executable: string;
  scripts: string;
  version: string;
}

const newEnough = (version: string) => {
  const [major, minor] = version.split('.').map(Number);
  return major! > 3 || (major === 3 && minor! >= 10);
};

/** The .venv python of `dir` or of the nearest folder above it that has one. */
function nearestVenv(dir: string, deps: ToolchainDeps): string | undefined {
  const python = deps.platform === 'win32' ? join(dir, '.venv', 'Scripts', 'python.exe') : join(dir, '.venv', 'bin', 'python');
  if (deps.exists(python)) return python;
  return dirname(dir) === dir ? undefined : nearestVenv(dirname(dir), deps);
}

/** A candidate's answer to the probe; undefined when it did not start or answer. */
function probe(command: string, cwd: string, deps: ToolchainDeps): Found | undefined {
  const r = deps.spawn(command, ['-c', PROBE], cwd);
  const [executable, scripts, version] = r.stdout.split(/\r?\n/).map((l) => l.trim());
  return r.status === 0 && executable && scripts && version ? { executable, scripts, version } : undefined;
}

export function pythonToolchain(cwd: string, deps: ToolchainDeps): PythonToolchain {
  let found: Found | undefined;

  function locate(): Found {
    const candidates = [deps.env.WORKFLOW_PYTHON, nearestVenv(cwd, deps), 'python3', 'python'].filter((c): c is string => Boolean(c));
    const tooOld: string[] = [];
    for (const candidate of candidates) {
      const a = probe(candidate, cwd, deps);
      if (a === undefined) continue;
      if (newEnough(a.version)) return a;
      tooOld.push(`${a.executable} is Python ${a.version}`);
    }
    throw new Error(tooOld.length === 0 ? NO_PYTHON : `${NO_PYTHON} (found: ${tooOld.join(', ')})`);
  }

  const python = () => (found ??= locate());

  function program(tool: PythonTool): string {
    const { executable, scripts, version } = python();
    const path = join(scripts, deps.platform === 'win32' ? `${tool}.exe` : tool);
    if (deps.exists(path)) return path;
    throw new Error(`${tool} is not installed for ${executable} (Python ${version}): run \`"${executable}" -m pip install "${PACKAGES[tool]}"\` in the project (a dev dependency of the project, not of the Workflow)`);
  }

  return {
    python: () => python().executable,
    require: (tool) => void program(tool),
    run: (tool, args, env) => deps.spawn(program(tool), args, cwd, env),
  };
}
