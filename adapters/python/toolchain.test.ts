import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_PYTHON, pythonToolchain, ranOf, runWithPython, type Ran, type ToolchainDeps } from './toolchain.ts';

const CWD = join('/work', 'app');
const VENV = join(CWD, '.venv', 'Scripts', 'python.exe');
const SCRIPTS = join(CWD, '.venv', 'Scripts');

const ok = (stdout: string): Ran => ({ status: 0, stdout, stderr: '' });
const enoent = (): Ran => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) });

/** Deps where `pythons` answer the probe (by command, with an executable and a version), and `existing` paths exist. */
function deps(pythons: Record<string, string | [string, string]>, existing: string[] = [], env: Record<string, string> = {}) {
  const calls: Array<{ command: string; args: string[]; cwd: string; env?: Record<string, string> }> = [];
  const d: ToolchainDeps & { calls: typeof calls } = {
    calls,
    platform: 'win32',
    env,
    exists: (path) => existing.includes(path),
    spawn: (command, args, cwd, extra) => {
      calls.push({ command, args, cwd, ...(extra === undefined ? {} : { env: extra }) });
      if (args[0] !== '-c') return ok(`ran ${command}`);
      const found = pythons[command];
      if (found === undefined) return enoent();
      const [exe, version] = typeof found === 'string' ? [found, '3.14.3'] : found;
      return ok(`${exe}\r\n${SCRIPTS}\r\n${version}\r\n`);
    },
  };
  return d;
}

describe('pythonToolchain', () => {
  it('accepts 3.10, skips incomplete or failed probes, and finds a POSIX venv', () => {
    const venv = join(CWD, '.venv', 'bin', 'python');
    const d: ToolchainDeps = {
      platform: 'linux',
      env: { WORKFLOW_PYTHON: 'custom' },
      exists: (path) => path === venv,
      spawn: (command, args) => {
        if (args[0] !== '-c' || !args[1]?.includes('sys.version_info[:3]')) return enoent();
        if (command === 'custom') return ok('/custom/python\n   \n3.14.0');
        if (command === venv) return ok('  /project/venv/python  \n  /project/venv/bin  \n  3.10.0  ');
        return enoent();
      },
    };
    expect(pythonToolchain(CWD, d).python()).toBe('/project/venv/python');
    expect(pythonToolchain(CWD, {
      ...d, exists: () => false,
      spawn: (command) => command === 'python' ? ok('/next/python\n/next/bin\n4.0.0') : { ...ok('/broken/python\n/broken/bin\n3.14.0'), status: 1 },
    }).python()).toBe('/next/python');
  });

  it('falls through on omitted version and executable fields', () => {
    const noVersion = { ...deps({ python: '/usr/bin/python' }), spawn: (command: string) => command === 'python3' ? ok('/other/python\n/other/bin') : ok('/usr/bin/python\n/usr/bin\n3.10.0') };
    const noExecutable = { ...noVersion, spawn: (command: string) => command === 'python3' ? ok('\n/other/bin\n3.10.0') : noVersion.spawn(command) };
    expect(pythonToolchain(CWD, noVersion).python()).toBe('/usr/bin/python');
    expect(pythonToolchain(CWD, noExecutable).python()).toBe('/usr/bin/python');
  });

  it("finds the project's .venv before a Python on PATH and gives its absolute executable", () => {
    const d = deps({ [VENV]: VENV, python: 'C:\\Python314\\python.exe' }, [VENV]);
    expect(pythonToolchain(CWD, d).python()).toBe(VENV);
  });

  it('finds the .venv of a folder above, as from the red check\'s base checkout inside the worktree', () => {
    const d = deps({ [VENV]: VENV, python: 'C:\\Python314\\python.exe' }, [VENV]);
    expect(pythonToolchain(join(CWD, '.red-check', 'base-1'), d).python()).toBe(VENV);
  });

  it('takes WORKFLOW_PYTHON first, and asks it for its own absolute path', () => {
    const d = deps({ 'C:\\tools\\py.exe': 'C:\\tools\\python.exe', [VENV]: VENV }, [VENV], { WORKFLOW_PYTHON: 'C:\\tools\\py.exe' });
    expect(pythonToolchain(CWD, d).python()).toBe('C:\\tools\\python.exe');
  });

  it('falls back to python3, then python, on PATH', () => {
    expect(pythonToolchain(CWD, deps({ python: '/usr/bin/python' })).python()).toBe('/usr/bin/python');
    expect(pythonToolchain(CWD, deps({ python3: '/usr/bin/python3', python: '/x' })).python()).toBe('/usr/bin/python3');
  });

  it('passes over a Python older than 3.10, and names it and its version when none is new enough', () => {
    expect(pythonToolchain(CWD, deps({ python3: ['/usr/bin/python3', '3.8.10'], python: '/usr/bin/python' })).python()).toBe('/usr/bin/python');
    expect(() => pythonToolchain(CWD, deps({ python3: ['/usr/bin/python3', '3.8.10'], python: ['/usr/bin/python', '2.7.18'] })).python()).toThrow(`${NO_PYTHON} (found: /usr/bin/python3 is Python 3.8.10, /usr/bin/python is Python 2.7.18)`);
  });

  it('says what to install when no Python starts', () => {
    expect(() => pythonToolchain(CWD, deps({})).python()).toThrow(NO_PYTHON);
    expect(NO_PYTHON).toMatch(/^Python 3\.10 or later was not found/);
  });

  it("runs a tool from the Python's scripts folder in the project folder, no shell", () => {
    const radon = join(SCRIPTS, 'radon.exe');
    const d = deps({ [VENV]: VENV }, [VENV, radon]);
    expect(pythonToolchain(CWD, d).run('radon', ['cc', '-j', 'a.py'])).toMatchObject({ status: 0, stdout: `ran ${radon}` });
    expect(d.calls.at(-1)).toEqual({ command: radon, args: ['cc', '-j', 'a.py'], cwd: CWD });
  });

  it('adds the variables it is given to the environment', () => {
    const lint = join(SCRIPTS, 'lint-imports.exe');
    const d = deps({ [VENV]: VENV }, [VENV, lint]);
    pythonToolchain(CWD, d).run('lint-imports', [], { PYTHONPATH: 'src' });
    expect(d.calls.at(-1)).toEqual({ command: lint, args: [], cwd: CWD, env: { PYTHONPATH: 'src' } });
  });

  it('names the tool, the interpreter, its version and the install command when the tool is not installed', () => {
    const d = deps({ [VENV]: VENV }, [VENV]);
    const message = `cosmic-ray is not installed for ${VENV} (Python 3.14.3): run \`"${VENV}" -m pip install "cosmic-ray==8.9.0"\` in the project (a dev dependency of the project, not of the Workflow)`;
    expect(() => pythonToolchain(CWD, d).run('cosmic-ray', ['baseline'])).toThrow(message);
    expect(() => pythonToolchain(CWD, d).require('cosmic-ray')).toThrow(message);
  });

  it('requires a tool without running it', () => {
    const pytest = join(SCRIPTS, 'pytest.exe');
    const d = deps({ [VENV]: VENV }, [VENV, pytest]);
    pythonToolchain(CWD, d).require('pytest');
    expect(d.calls.map((c) => c.command)).toEqual([VENV]);
  });

  it('runs scripts without .exe off Windows', () => {
    const bin = join(CWD, '.venv', 'Scripts', 'bandit');
    const d = { ...deps({ python3: '/usr/bin/python3' }, [bin]), platform: 'linux' };
    expect(pythonToolchain(CWD, d).run('bandit', ['-f', 'json'])).toMatchObject({ status: 0 });
  });

  it('probes once, however many tools run', () => {
    const radon = join(SCRIPTS, 'radon.exe');
    const d = deps({ [VENV]: VENV }, [VENV, radon]);
    const chain = pythonToolchain(CWD, d);
    chain.run('radon', []);
    chain.run('radon', []);
    expect(d.calls.filter((c) => c.args[0] === '-c')).toHaveLength(1);
  });
});

describe('runWithPython', () => {
  it("runs the project's Python with the arguments and gives its exit code", () => {
    const ran: Array<[string, string[]]> = [];
    expect(runWithPython(['-m', 'pytest', '-q'], { python: () => VENV }, (command, args) => (ran.push([command, args]), 3), () => {})).toBe(3);
    expect(ran).toEqual([[VENV, ['-m', 'pytest', '-q']]]);
  });

  it('exits 1 when the process gave no exit code (killed), and 2 with the reason when there is no Python', () => {
    expect(runWithPython([], { python: () => VENV }, () => null, () => {})).toBe(1);
    const said: string[] = [];
    const none = () => {
      throw new Error(NO_PYTHON);
    };
    expect(runWithPython([], { python: none }, () => 0, (text) => said.push(text))).toBe(2);
    expect(said).toEqual([`${NO_PYTHON}\n`]);
  });
});

describe('ranOf', () => {
  it("keeps spawnSync's status and output, empty text for no output, and its error", () => {
    expect(ranOf({ status: 1, stdout: 'o', stderr: 'e' })).toEqual({ status: 1, stdout: 'o', stderr: 'e' });
    const error = new Error('spawn ENOENT');
    expect(ranOf({ status: null, stdout: null, stderr: null, error })).toEqual({ status: null, stdout: '', stderr: '', error });
  });
});

it.each([
  ['pytest', 'pytest'],
  ['coverage', 'coverage>=7.10'],
  ['radon', 'radon'],
  ['bandit', 'bandit'],
  ['pip-audit', 'pip-audit'],
  ['lint-imports', 'import-linter'],
] as const)('names the installation requirement for %s', (tool, requirement) => {
  const chain = pythonToolchain(CWD, deps({ python: '/tools/python' }));
  expect(() => chain.require(tool)).toThrow(new Error(
    tool + ' is not installed for /tools/python (Python 3.14.3): run `"/tools/python" -m pip install "' +
    requirement + '"` in the project (a dev dependency of the project, not of the Workflow)',
  ));
});

it('skips Python 2 even when its minor version is above the Python 3 threshold', () => {
  expect(pythonToolchain(CWD, deps({ python3: ['/old/jython', '2.11.0'], python: '/tools/python' })).python())
    .toBe('/tools/python');
});

it('keeps the full diagnostic when no interpreter answers', () => {
  expect(() => pythonToolchain(CWD, deps({})).python()).toThrow(new Error(
    "Python 3.10 or later was not found: install it (https://www.python.org/downloads/), create the project's .venv (`python -m venv .venv`) and install its dev tools there, or set WORKFLOW_PYTHON to its python",
  ));
});

it('omits the error field when the process has no error', () => {
  expect(ranOf({ status: 0, stdout: '', stderr: '' })).toStrictEqual({ status: 0, stdout: '', stderr: '' });
});
