import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedFiles, INSTALL_HINT, sastCli, sastGate, sastLines, sastSince, SEMGREP_ARGS, type SastCliIo, type SastIo } from './gate.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'sast');
const RULES = join('w', 'gates', 'sast', 'rules');
const TEMP = join('tmp', 'sast-base');

// The recorded TypeScript sources are kept as .ts.txt: Stryker's sandbox puts a `// @ts-nocheck`
// line on top of every .ts file under test/, which would move each line the recordings name.
const fileIn = (dir: string, file: string) => {
  const path = join(FIXTURES, dir, ...file.split('/')) + (file.endsWith('.ts') ? '.txt' : '');
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

type Call = { args: string[]; cwd: string };

/** The recorded scan of a case's head (in the worktree) or base (in the temp folder), with every call and write kept. */
function fakeIo(scenario: string, over: Partial<SastIo> = {}) {
  const calls: Call[] = [];
  const written: [string, string][] = [];
  const removed: string[] = [];
  const io: SastIo = {
    semgrep: (args, cwd) => {
      calls.push({ args, cwd });
      const side = cwd === TEMP ? 'base' : 'head';
      return { status: 0, stdout: readFileSync(join(FIXTURES, scenario, `${side}.json`), 'utf8') };
    },
    readHead: (file) => fileIn(join(scenario, 'head'), file),
    readBase: (file) => fileIn(join(scenario, 'base'), file),
    bandit: () => {
      throw new Error('bandit was not expected to run');
    },
    tempDir: () => TEMP,
    write: (path, text) => void written.push([path, text]),
    remove: (dir) => void removed.push(dir),
    ...over,
  };
  return { io, calls, written, removed };
}

const opts = (files: string[]) => ({ cwd: 'repo', files, rules: RULES });

describe('sastGate with recorded Semgrep output', () => {
  it('fails on a new ERROR finding, naming its rule, file and line', () => {
    const { io, calls } = fakeIo('new-error');
    const r = sastGate(opts(['src/ping.ts', 'README.md']), io);
    expect(r).toMatchObject({ gate: 'sast', pass: false, warnings: [], suppressed: [], notScanned: [] });
    expect(r.error).toBeUndefined();
    expect(r.findings).toEqual([expect.objectContaining({ rule: 'javascript.lang.security.detect-child-process', severity: 'ERROR', file: 'src/ping.ts', line: 4 })]);
    expect(r.scanned).toEqual(['src/ping.ts']);
    expect(r.semgrep).toBe('1.179.0');
    expect('note' in r).toBe(false);
    // No base file, so no base scan.
    expect(calls).toEqual([{ args: [...SEMGREP_ARGS(RULES), 'src/ping.ts'], cwd: 'repo' }]);
  });

  it('passes when the same finding is at the base, though its line moved', () => {
    const { io, calls, written, removed } = fakeIo('at-base');
    const r = sastGate(opts(['src/ping.ts']), io);
    expect(r).toMatchObject({ pass: true, findings: [], warnings: [] });
    expect(calls.map((c) => c.cwd)).toEqual(['repo', TEMP]);
    expect(calls[1]!.args).toEqual([...SEMGREP_ARGS(RULES), 'src/ping.ts']);
    expect(written).toEqual([[join(TEMP, 'src', 'ping.ts'), fileIn(join('at-base', 'base'), 'src/ping.ts')]]);
    expect(removed).toEqual([TEMP]);
  });

  it('reports a WARNING and passes', () => {
    const { io } = fakeIo('warning');
    const r = sastGate(opts(['src/match.ts']), io);
    expect(r.pass).toBe(true);
    expect(r.warnings).toEqual([expect.objectContaining({ rule: 'javascript.lang.security.audit.detect-non-literal-regexp', severity: 'WARNING', file: 'src/match.ts', line: 2 })]);
  });

  it('passes a finding suppressed with its rule and a reason, and reports the suppression', () => {
    const { io } = fakeIo('suppressed');
    const r = sastGate(opts(['src/list.ts']), io);
    expect(r.pass).toBe(true);
    expect(r.suppressed).toEqual([expect.objectContaining({ rule: 'javascript.lang.security.detect-child-process', line: 5, reason: 'dir comes from our own config, never from a user' })]);
  });

  it('fails a suppression without a reason, and the finding it did not suppress', () => {
    const { io } = fakeIo('unreasoned');
    const r = sastGate(opts(['src/list.ts']), io);
    expect(r.pass).toBe(false);
    expect(r.findings!.map((f) => [f.rule, f.line])).toEqual([
      ['javascript.lang.security.detect-child-process', 4],
      ['sast.suppression-without-reason', 4],
    ]);
  });

  it('proves the pinned rules bite: an injection in TypeScript and one in C# both fail', () => {
    const { io } = fakeIo('bites');
    const r = sastGate(opts(['src/inject.ts', 'src/Inject.cs']), io);
    expect(r.pass).toBe(false);
    expect(r.findings!.map((f) => [f.rule, f.file, f.line])).toEqual([
      ['csharp.lang.security.injections.os-command-injection', 'src/Inject.cs', 10],
      ['javascript.lang.security.detect-child-process', 'src/inject.ts', 4],
    ]);
  });

  it('passes without running Semgrep when no changed file is a source file it has rules for', () => {
    const { io, calls } = fakeIo('new-error');
    expect(sastGate(opts(['README.md', 'src/a.test.ts', 'src/gone.ts']), io)).toEqual({ gate: 'sast', pass: true, scanned: [], findings: [], warnings: [], suppressed: [], notScanned: [] });
    expect(calls).toEqual([]);
  });

  it('notes a Semgrep that is not the pinned version, and the files it could not parse', () => {
    const json = JSON.stringify({ version: '1.2.3', results: [], errors: [{ level: 'warn', type: 'Syntax error', path: 'src/ping.ts' }] });
    const { io } = fakeIo('new-error', { semgrep: () => ({ status: 0, stdout: json }) });
    const r = sastGate(opts(['src/ping.ts']), io);
    expect(r).toMatchObject({ pass: false, semgrep: '1.2.3', notScanned: ['src/ping.ts: Syntax error'] });
    expect(sastLines(r)).toContain('not scanned: src/ping.ts: Syntax error');
    expect(r.note).toMatch(/Semgrep 1.2.3 is running; the rules were pinned with 1.179.0/);
  });

  it('could not run when Semgrep is missing, saying what to install', () => {
    const missing = Object.assign(new Error('spawnSync semgrep ENOENT'), { code: 'ENOENT' });
    const { io } = fakeIo('new-error', { semgrep: () => ({ status: null, stdout: '', error: missing }) });
    expect(sastGate(opts(['src/ping.ts']), io)).toEqual({ gate: 'sast', pass: false, error: INSTALL_HINT });
    expect(INSTALL_HINT).toMatch(/pip install semgrep==1\.179\.0/);
  });

  it('could not run when Semgrep fails to start for another reason, or exits non-zero', () => {
    const { io } = fakeIo('new-error', { semgrep: () => ({ status: null, stdout: '', error: new Error('spawnSync semgrep ETIMEDOUT') }) });
    expect(sastGate(opts(['src/ping.ts']), io).error).toBe('Semgrep could not start: spawnSync semgrep ETIMEDOUT');
    const recorded = readFileSync(join(FIXTURES, 'no-config.json'), 'utf8');
    const { io: io2 } = fakeIo('new-error', { semgrep: () => ({ status: 7, stdout: recorded }) });
    expect(sastGate(opts(['src/ping.ts']), io2).error).toMatch(/^Semgrep exited 7: WARNING: unable to find a config/);
  });

  it('removes the base folder even when the base scan could not run', () => {
    const { io, removed } = fakeIo('at-base', { semgrep: (_args, cwd) => (cwd === TEMP ? { status: 2, stdout: '' } : { status: 0, stdout: '{"results":[],"errors":[]}' }) });
    expect(sastGate(opts(['src/ping.ts']), io).error).toBe('Semgrep exited 2: no JSON on stdout');
    expect(removed).toEqual([TEMP]);
  });
});

describe('sastGate on Python with bandit (ticket 99)', () => {
  const RUN = 'import subprocess\n\n\ndef run(cmd):\n    return subprocess.call(cmd, shell=True)\n';
  const banditJson = (dir: string, lines: number[]) =>
    JSON.stringify({ errors: [], results: lines.map((line_number) => ({ test_id: 'B602', issue_severity: 'HIGH', issue_confidence: 'HIGH', filename: join(dir, 'src', 'run.py'), line_number, issue_text: 'subprocess call with shell=True identified, security issue.' })) });

  /** A Python change: src/run.py at head, `base` at the base (or none); bandit finds shell=True on `headLines` and `baseLines`. */
  function pyIo(head: string, base: string | undefined, headLines: number[], baseLines: number[] = []) {
    const banditCalls: string[][] = [];
    const semgrepCalls: string[][] = [];
    const { io, removed } = fakeIo('new-error', {
      semgrep: (args) => (semgrepCalls.push(args), { status: 0, stdout: '{"results":[],"errors":[]}' }),
      bandit: (args) => {
        banditCalls.push(args);
        const inBase = args.at(-1)!.startsWith(TEMP);
        return { status: 1, stdout: banditJson(inBase ? TEMP : 'repo', inBase ? baseLines : headLines) };
      },
      readHead: (file) => (file === 'src/run.py' ? head : undefined),
      readBase: (file) => (file === 'src/run.py' ? base : undefined),
    });
    return { io, banditCalls, semgrepCalls, removed };
  }

  it('fails on a new HIGH bandit finding, without running Semgrep, which has no Python rules here', () => {
    const { io, banditCalls, semgrepCalls } = pyIo(RUN, undefined, [5]);
    const r = sastGate(opts(['src/run.py', 'tests/test_run.py']), io);
    expect(r).toMatchObject({ pass: false, scanned: ['src/run.py'], findings: [{ rule: 'bandit.B602', severity: 'ERROR', file: 'src/run.py', line: 5 }] });
    expect(banditCalls).toEqual([['-f', 'json', '-q', join('repo', 'src', 'run.py')]]);
    expect(semgrepCalls).toEqual([]);
    expect('semgrep' in r).toBe(false);
  });

  it('passes when the base had the same finding, scanning the base copy in a temp folder', () => {
    const { io, banditCalls, removed } = pyIo(`# runs commands\n${RUN}`, RUN, [6], [5]);
    expect(sastGate(opts(['src/run.py']), io)).toMatchObject({ pass: true, findings: [] });
    expect(banditCalls[1]).toEqual(['-f', 'json', '-q', join(TEMP, 'src', 'run.py')]);
    expect(removed).toEqual([TEMP]);
  });

  it('fails a new # nosec without a test id and reason', () => {
    const { io } = pyIo(RUN.replace('shell=True)', 'shell=True)  # nosec'), undefined, []);
    expect(sastGate(opts(['src/run.py']), io).findings).toEqual([expect.objectContaining({ rule: 'sast.suppression-without-reason', line: 5 })]);
  });

  it('runs Semgrep and bandit side by side on a mixed change', () => {
    const { io, banditCalls, semgrepCalls } = pyIo(RUN, undefined, []);
    const r = sastGate(opts(['src/run.py', 'src/ping.ts']), { ...io, readHead: (file) => (file === 'src/run.py' ? RUN : fileIn(join('new-error', 'head'), file)) });
    expect(r.scanned).toEqual(['src/ping.ts', 'src/run.py']);
    expect([semgrepCalls.length, banditCalls.length]).toEqual([1, 1]);
  });

  it('could not run when bandit is missing', () => {
    const { io } = pyIo(RUN, undefined, []);
    const missing = { ...io, bandit: () => { throw new Error('bandit is not installed for /py: run `"/py" -m pip install "bandit"`'); } };
    expect(sastGate(opts(['src/run.py']), missing)).toEqual({ gate: 'sast', pass: false, error: 'bandit is not installed for /py: run `"/py" -m pip install "bandit"`' });
  });
});

describe('SEMGREP_ARGS', () => {
  it('runs local rules only, JSON out, with metrics, the version check and Semgrep\'s own nosemgrep off', () => {
    expect(SEMGREP_ARGS('r')).toEqual(['scan', '--config', 'r', '--json', '--metrics=off', '--disable-version-check', '--disable-nosem', '--']);
  });
});

describe('sastLines', () => {
  it('names each blocking finding and warning at its line, and why it could not run', () => {
    const f = { rule: 'r', severity: 'ERROR', file: 'a.ts', line: 3, message: ' bad \n thing ' };
    expect(sastLines({ gate: 'sast', pass: false, findings: [f], warnings: [{ ...f, severity: 'WARNING' }], note: 'n' })).toEqual([
      'BLOCKING a.ts:3 r (ERROR): bad thing',
      'reported a.ts:3 r (WARNING): bad thing',
      'n',
    ]);
    expect(sastLines({ gate: 'sast', pass: false, error: 'no semgrep' })).toEqual(['could not run: no semgrep']);
    expect(sastLines({ gate: 'sast', pass: true })).toEqual([]);
  });
});

describe('changedFiles', () => {
  it('lists the files changed since the base and the untracked ones, once each', () => {
    const git = (args: string[]) => ({ status: 0, stdout: args[0] === 'diff' ? 'src/a.ts\0src/b c.cs\0' : 'src/a.ts\0new.ts\0' });
    expect(changedFiles('main', git)).toEqual(['src/a.ts', 'src/b c.cs', 'new.ts']);
  });

  it('asks git for the changes that leave a file, not deletions', () => {
    const seen: string[][] = [];
    changedFiles('main', (args) => (seen.push(args), { status: 0, stdout: '' }));
    expect(seen).toEqual([
      ['diff', '--name-only', '--relative', '-z', '--diff-filter=d', 'main', '--'],
      ['ls-files', '-z', '--others', '--exclude-standard'],
    ]);
  });

  it('throws when git cannot diff against the base', () => {
    expect(() => changedFiles('nope', () => ({ status: 128, stdout: '' }))).toThrow('git cannot diff against nope');
  });
});

describe('sastCli', () => {
  const cliIo = (over: Partial<SastCliIo> = {}) => {
    const { io, calls, written } = fakeIo('new-error');
    const git = (args: string[]) => {
      if (args[0] === 'diff') return { status: 0, stdout: 'src/ping.ts\0' };
      if (args[0] === 'show') return { status: 128, stdout: '' };
      return { status: 0, stdout: '' };
    };
    return { io: { ...io, git, ...over } as SastCliIo, calls, written };
  };

  it('scans the files changed since --base in --cwd, with the base files from git', () => {
    const { io, calls } = cliIo();
    const at: string[] = [];
    const r = sastCli(['--base', 'main', '--cwd', 'repo'], { rules: RULES }, (cwd) => (at.push(cwd), io));
    expect(r.pass).toBe(false);
    expect(at).toEqual(['repo']);
    expect(calls[0]!.cwd).toBe('repo');
  });

  it('writes its result to --json too', () => {
    const { io, written } = cliIo();
    const r = sastCli(['--base', 'main', '--json', join('out', 'sast.json')], { rules: RULES, cwd: 'here' }, () => io);
    expect(written).toEqual([[join('out', 'sast.json'), `${JSON.stringify(r, null, 2)}\n`]]);
  });

  it('writes nothing without --json, and runs in the current folder without --cwd', () => {
    const { io, written } = cliIo();
    const at: string[] = [];
    sastCli(['--base', 'main'], { rules: RULES }, (cwd) => (at.push(cwd), io));
    expect(at).toEqual(['.']);
    expect(written).toEqual([]);
  });

  it('refuses without --base, or with a base that reads as an option', () => {
    const { io } = cliIo();
    expect(() => sastCli([], { rules: RULES }, () => io)).toThrow('usage: node gates/sast/cli.ts --base <ref> [--cwd <dir>] [--json <path>]');
    expect(() => sastCli(['--base=-x'], { rules: RULES }, () => io)).toThrow('not a git ref: -x');
  });
});

describe('sastSince', () => {
  it('reads each base file with git show at the ref', () => {
    const shown: string[][] = [];
    const { io, calls } = fakeIo('at-base');
    const git = (args: string[]) => {
      shown.push(args);
      return { status: 0, stdout: fileIn(join('at-base', 'base'), 'src/ping.ts')! };
    };
    expect(sastSince('HEAD', opts(['src/ping.ts']), { ...io, git }).pass).toBe(true);
    expect(shown).toEqual([['show', 'HEAD:./src/ping.ts']]);
    expect(calls.map((c) => c.cwd)).toEqual(['repo', TEMP]);
  });
});

it('names the Bandit process startup error', () => {
  const { io } = fakeIo('new-error', {
    bandit: () => ({ status: null, stdout: '', error: new Error('permission denied') }),
    readHead: () => 'x = 1',
  });
  expect(sastGate(opts(['src/run.py']), io)).toEqual({
    gate: 'sast', pass: false, error: 'bandit could not start: permission denied',
  });
});

it('returns Bandit suppressions as an empty list when the scan is clean', () => {
  const { io } = fakeIo('new-error', {
    bandit: () => ({ status: 0, stdout: '{"results":[]}' }),
    readHead: () => 'x = 1',
    readBase: () => undefined,
  });
  expect(sastGate(opts(['src/run.py']), io)).toEqual({
    gate: 'sast', pass: true, scanned: ['src/run.py'], findings: [], warnings: [], suppressed: [], notScanned: [],
  });
});
