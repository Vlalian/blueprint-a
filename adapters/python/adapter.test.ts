import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crapGate, mutationGate } from '../../gates/test-strength/gate.ts';
import { cosmicConfig, mutantsOfDump, parseCoverage, parseRadon, pythonAdapter, rowsOf, type PythonIo } from './adapter.ts';
import type { PythonTool, Ran } from './toolchain.ts';

// The recorded outputs were made on fixtures/python-sample (coverage.py 7.17.5, radon 6.0.1,
// cosmic-ray 8.9.0, Python 3.14.3 on Windows): coverage with all tests, coverage without
// tests/test_grades.py, and cosmic-ray's dump of parity.py without test_two_and_four_are_even.
const ROOT = resolve('/work/python-sample');
const recorded = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const TESTED = recorded('coverage-tested.json');
const UNTESTED = recorded('coverage-untested.json');
const RADON = recorded('radon.json');
const DUMP = recorded('cosmic-ray-dump.jsonl');
const INCOMPETENT = recorded('cosmic-ray-incompetent.jsonl');
const GRADES = 'src/sample/grades.py';
const PARITY = 'src/sample/parity.py';
const PYTHON = 'C:\\Python Tools\\.venv\\Scripts\\python.exe';
const keyOf = (abs: string) => abs.slice(ROOT.length + 1).split('\\').join('/');

const ok = (stdout = ''): Ran => ({ status: 0, stdout, stderr: '' });

interface Fake extends PythonIo {
  runs: Array<[PythonTool, string[]]>;
  required: PythonTool[];
  written: Record<string, string>;
  removed: string[];
}

/** A fake project: `onRun` answers each tool run; files under the temp folder are what the run wrote. */
function fakeIo(onRun: (tool: PythonTool, args: string[], written: Record<string, string>) => Ran, files: Record<string, string[]> = {}, missing: PythonTool[] = [], changed: Array<{ file: string; line: number }> = []): Fake {
  const tmp = join(ROOT, 'tmp-1');
  const io: Fake = {
    runs: [],
    required: [],
    written: {},
    removed: [],
    read: (path) => {
      const text = io.written[path];
      if (text === undefined) throw new Error(`no file ${path}`);
      return text;
    },
    write: (path, text) => {
      io.written[path] = text;
    },
    tempDir: () => tmp,
    remove: (dir) => {
      io.removed.push(dir);
    },
    pyFiles: (path) => files[path] ?? [path],
    changedLines: () => changed.map((c) => ({ ...c, text: '' })),
    tools: {
      python: () => PYTHON,
      require: (tool) => {
        io.required.push(tool);
        if (missing.includes(tool)) throw new Error(`${tool} is not installed for ${PYTHON}`);
      },
      run: (tool, args) => (io.runs.push([tool, args]), onRun(tool, args, io.written)),
    },
  };
  return io;
}

/** A project whose test run writes `coverage` and whose radon run prints the recorded complexity. */
function measured(coverage: string, pytest: Ran = ok()) {
  return fakeIo((tool, args, written) => {
    if (tool === 'coverage' && args[0] === 'run') return pytest;
    if (tool === 'coverage' && args[0] === 'json') written[args[args.indexOf('-o') + 1]!] = coverage;
    if (tool === 'radon') return ok(RADON);
    return ok();
  });
}

const options = { cwd: ROOT, coverageFile: undefined, base: undefined };

describe('parseRadon', () => {
  it('gives every function, method and closure once, with its line range; classes are left out', () => {
    expect(parseRadon(RADON, (p) => p)).toEqual([
      { file: GRADES, name: 'grade', startLine: 4, endLine: 11, complexity: 4 },
      { file: GRADES, name: 'Report.grade', startLine: 15, endLine: 16, complexity: 1 },
      { file: PARITY, name: 'is_even', startLine: 4, endLine: 5, complexity: 1 },
    ]);
  });

  it('names a closure after its function', () => {
    const json = JSON.stringify({ 'm.py': [{ type: 'function', name: 'outer', lineno: 9, endline: 14, complexity: 1, closures: [{ type: 'function', name: 'inner', lineno: 10, endline: 13, complexity: 2, closures: [] }] }] });
    expect(parseRadon(json, (p) => p).map((b) => [b.name, b.startLine, b.complexity])).toEqual([['outer', 9, 1], ['outer.inner', 10, 2]]);
  });

  it('turns a file radon could not parse into an error naming it', () => {
    expect(() => parseRadon(JSON.stringify({ 'bad.py': { error: 'invalid syntax (<unknown>, line 3)' } }), (p) => p)).toThrow('radon could not read bad.py: invalid syntax');
  });
});

describe('parseCoverage', () => {
  it("keeps each file's function regions by their first line", () => {
    const regions = parseCoverage(UNTESTED, (p) => keyOf(resolve(ROOT, p))).get(GRADES);
    expect(regions?.find((r) => r.startLine === 4)).toEqual({ startLine: 4, executed: [], missing: [5, 6, 7, 8, 9, 10, 11] });
  });

  it('needs function regions, which coverage.py 7.10 added', () => {
    const old = JSON.stringify({ meta: { version: '7.4.0' }, files: { 'a.py': { executed_lines: [1], missing_lines: [] } } });
    expect(() => parseCoverage(old, (p) => p)).toThrow('coverage.py 7.4.0 wrote no function regions for a.py: install coverage 7.10 or later');
  });
});

describe('rowsOf', () => {
  it("joins complexity to coverage by the function's first line, not its name", () => {
    const blocks = parseRadon(RADON, (p) => p);
    const rows = rowsOf(blocks, parseCoverage(TESTED, (p) => keyOf(resolve(ROOT, p))));
    expect(rows.map((r) => [r.name, r.lines, r.covered, r.complexity])).toEqual([['grade', 7, 7, 4], ['Report.grade', 1, 1, 1], ['is_even', 1, 1, 1]]);
  });

  it('fails when coverage has no region where radon found a function', () => {
    const blocks = [{ file: 'a.py', name: 'f', startLine: 3, endLine: 4, complexity: 1 }];
    expect(() => rowsOf(blocks, new Map([['a.py', []]]))).toThrow('the coverage has no function at a.py:3 (f)');
    expect(() => rowsOf(blocks, new Map())).toThrow('the coverage has no record of a.py: do the tests import it?');
  });
});

describe('mutantsOfDump', () => {
  it('rejects an unknown outcome and reports only the first nonblank output line', () => {
    const work = { mutations: [{ module_path: 'src\\a.py', operator_name: 'core/X', start_pos: [2, 0] }] };
    const unexpected = { worker_outcome: 'normal', test_outcome: 'unknown', output: '  first\r\nsecond  ' };
    expect(() => mutantsOfDump(` \r\n${JSON.stringify([work, unexpected])}\r\n`, (p) => p))
      .toThrow(/^cosmic-ray could not test 1 of 1 mutants \(outcome unknown\), first src\/a\.py:2 core\/X: first$/);
    expect(() => mutantsOfDump(JSON.stringify([work, { ...unexpected, test_outcome: null, output: '' }]), (p) => p))
      .toThrow(/^cosmic-ray could not test 1 of 1 mutants \(outcome null\), first src\/a\.py:2 core\/X$/);
  });
  it("reads each mutant's file, line, operator and outcome from cosmic-ray's dump", () => {
    const mutants = mutantsOfDump(DUMP, (p) => keyOf(resolve(ROOT, p)));
    expect(mutants).toHaveLength(14);
    expect(mutants[0]).toEqual({ file: PARITY, line: 5, mutator: 'core/ReplaceBinaryOperator_Mod_Add', status: 'Survived' });
    expect(mutants.filter((m) => m.status === 'Killed')).toHaveLength(4);
  });

  it('cannot run on an incompetent mutant: the tests never ran, so 0 survivors would be a lie', () => {
    expect(() => mutantsOfDump(INCOMPETENT, (p) => p)).toThrow(/^cosmic-ray could not test 2 of 2 mutants \(incompetent: the test command did not run\), first src\/sample\/parity\.py:5 core\/ReplaceBinaryOperator_Mod_Add:/);
  });

  it('cannot run on a mutant cosmic-ray never executed or whose worker broke', () => {
    const work = { mutations: [{ module_path: 'a.py', operator_name: 'core/X', start_pos: [2, 0] }] };
    expect(() => mutantsOfDump(JSON.stringify([work, null]), (p) => p)).toThrow('cosmic-ray could not test 1 of 1 mutants (not executed), first a.py:2 core/X');
    expect(() => mutantsOfDump(JSON.stringify([work, { worker_outcome: 'exception', test_outcome: null, output: 'boom' }]), (p) => p)).toThrow('(exception), first a.py:2 core/X: boom');
  });

  it('leaves out a mutant cosmic-ray skipped by its filters', () => {
    const work = { mutations: [{ module_path: 'a.py', operator_name: 'core/X', start_pos: [2, 0] }] };
    expect(mutantsOfDump(JSON.stringify([work, { worker_outcome: 'skipped', test_outcome: null, output: '' }]), (p) => p)).toEqual([]);
  });
});

describe('cosmicConfig', () => {
  it('writes the complete local cosmic-ray config', () => {
    expect(cosmicConfig('C:\\Python Tools\\python.exe', ['src/a.py', 'src/b.py'])).toBe([
      '[cosmic-ray]',
      "module-path = ['src/a.py', 'src/b.py']",
      'timeout = 120.0',
      'excluded-modules = []',
      `test-command = '"C:/Python Tools/python.exe" -m pytest -x -q -p no:cacheprovider'`,
      '',
      '[cosmic-ray.distributor]',
      "name = 'local'",
      '',
    ].join('\n'));
  });
  it("runs pytest with the Python's absolute path, quoted and with forward slashes, on the named modules", () => {
    const config = cosmicConfig(PYTHON, [PARITY, GRADES]);
    expect(config).toContain(`module-path = ['${PARITY}', '${GRADES}']`);
    expect(config).toContain(`test-command = '"C:/Python Tools/.venv/Scripts/python.exe" -m pytest -x -q -p no:cacheprovider'`);
    expect(config).toContain("name = 'local'");
  });
});

describe('pythonAdapter', () => {
  it('reports coverage JSON and radon failures with the available diagnostics', () => {
    const badJson = fakeIo((tool, args) => tool === 'coverage' && args[0] === 'json'
      ? { status: 2, stdout: 'details', stderr: 'bad data', error: new Error('cannot write') }
      : ok());
    expect(() => pythonAdapter(options, badJson).coverage([GRADES]))
      .toThrow('coverage json exited 2:\ndetails\nbad data\ncannot write');
    const badRadon = measured(TESTED);
    const run = badRadon.tools.run;
    badRadon.tools.run = (tool, args) => tool === 'radon' ? { status: 2, stdout: '', stderr: 'bad file' } : run(tool, args);
    expect(() => pythonAdapter(options, badRadon).complexity([GRADES])).toThrow('radon exited 2:\nbad file');
  });
  it('measures complexity and coverage from one test run: the crap gate passes the tested sample', () => {
    const io = measured(TESTED);
    const result = crapGate([GRADES, PARITY], pythonAdapter(options, io));
    expect(result).toMatchObject({ pass: true, functions: 3, over: [] });
    expect(io.runs.filter(([tool]) => tool === 'coverage')).toHaveLength(2);
    expect(io.runs[0]).toEqual(['coverage', ['run', '--data-file', join(ROOT, 'tmp-1', '.coverage'), '--source', 'src/sample', '-m', 'pytest', '-q', '-p', 'no:cacheprovider']]);
    expect(io.runs.find(([tool]) => tool === 'radon')).toEqual(['radon', ['cc', '-j', GRADES, PARITY]]);
    expect(io.removed).toEqual([join(ROOT, 'tmp-1')]);
  });

  it('fails an untested branchy function and names it, CRAP 4^2 + 4 = 20', () => {
    const result = crapGate([GRADES, PARITY], pythonAdapter(options, measured(UNTESTED)));
    expect(result).toMatchObject({ pass: false, over: [{ file: GRADES, name: 'grade', startLine: 4, complexity: 4, crap: 20 }] });
  });

  it('cannot measure coverage on a red suite', () => {
    const io = measured(TESTED, { status: 1, stdout: '1 failed', stderr: '' });
    expect(() => pythonAdapter(options, io).coverage([GRADES])).toThrow('pytest exited 1; coverage needs a green suite:\n1 failed');
    expect(io.removed).toEqual([join(ROOT, 'tmp-1')]);
  });

  it('reads a coverage file it is given instead of running the tests', () => {
    const io = fakeIo((tool) => (tool === 'radon' ? ok(RADON) : ok()));
    io.written[join(ROOT, 'cov.json')] = UNTESTED;
    const result = crapGate([GRADES], pythonAdapter({ cwd: ROOT, coverageFile: 'cov.json', base: undefined }, io));
    expect(result).toMatchObject({ pass: false, over: [{ file: GRADES, name: 'grade' }] });
    expect(io.runs.map(([tool]) => tool)).toEqual(['radon']);
  });

  it('measures every .py file under a named folder, leaving out its tests', () => {
    const files = { [join(ROOT, 'src')]: [join(ROOT, GRADES), join(ROOT, 'src/sample/test_x.py'), join(ROOT, PARITY)] };
    const io = fakeIo((tool, args, written) => {
      if (tool === 'coverage' && args[0] === 'json') written[args[args.indexOf('-o') + 1]!] = TESTED;
      return tool === 'radon' ? ok(RADON) : ok();
    }, files);
    pythonAdapter(options, io).complexity(['src']);
    expect(io.runs.find(([tool]) => tool === 'radon')).toEqual(['radon', ['cc', '-j', GRADES, PARITY]]);
  });

  it('runs the baseline, then cosmic-ray on the files, and the mutation gate names the survivor', () => {
    const io = fakeIo((tool, args) => (tool === 'cosmic-ray' && args[0] === 'dump' ? ok(DUMP) : ok()));
    const result = mutationGate([PARITY], pythonAdapter(options, io), () => undefined);
    expect(result).toMatchObject({ pass: false, mutants: 14 });
    expect(result.standing).toContainEqual({ file: PARITY, line: 5, mutator: 'core/ReplaceBinaryOperator_Mod_Add', status: 'Survived' });
    const config = join(ROOT, 'tmp-1', 'cosmic-ray.toml');
    const session = join(ROOT, 'tmp-1', 'session.sqlite');
    expect(io.runs).toEqual([
      ['cosmic-ray', ['baseline', config]],
      ['cosmic-ray', ['init', config, session]],
      ['cosmic-ray', ['exec', config, session]],
      ['cosmic-ray', ['dump', session]],
    ]);
    expect(io.written[config]).toBe(cosmicConfig(PYTHON, [PARITY]));
    expect(io.removed).toEqual([join(ROOT, 'tmp-1')]);
  });

  it('with a base, mutates only the named files the change touched, and keeps only the mutants on its changed lines', () => {
    const io = fakeIo((tool, args) => (tool === 'cosmic-ray' && args[0] === 'dump' ? ok(DUMP) : ok()), {}, [], [{ file: PARITY, line: 5 }, { file: 'README.md', line: 1 }]);
    const mutants = pythonAdapter({ ...options, base: 'origin/main' }, io).mutate([PARITY, GRADES]);
    expect(io.written[join(ROOT, 'tmp-1', 'cosmic-ray.toml')]).toBe(cosmicConfig(PYTHON, [PARITY]));
    expect(mutants).toHaveLength(14);
    const elsewhere = fakeIo((tool, args) => (tool === 'cosmic-ray' && args[0] === 'dump' ? ok(DUMP) : ok()), {}, [], [{ file: PARITY, line: 4 }]);
    expect(pythonAdapter({ ...options, base: 'origin/main' }, elsewhere).mutate([PARITY])).toEqual([]);
  });

  it('with a base the change did not reach, runs nothing and mutates nothing', () => {
    const io = fakeIo(() => ok(), {}, [], [{ file: 'README.md', line: 1 }]);
    expect(pythonAdapter({ ...options, base: 'origin/main' }, io).mutate([PARITY])).toEqual([]);
    expect(io.runs).toEqual([]);
  });

  it('needs pytest before it measures coverage or mutates, and runs nothing without it', () => {
    const io = fakeIo(() => ok(), {}, ['pytest']);
    expect(() => pythonAdapter(options, io).coverage([GRADES])).toThrow(`pytest is not installed for ${PYTHON}`);
    expect(() => pythonAdapter(options, io).mutate([PARITY])).toThrow(`pytest is not installed for ${PYTHON}`);
    expect(io.runs).toEqual([]);
  });

  it('cannot run when the baseline fails: a red suite kills every mutant', () => {
    const io = fakeIo((tool, args) => (args[0] === 'baseline' ? { status: 1, stdout: '', stderr: 'Baseline failed' } : ok()));
    expect(() => pythonAdapter(options, io).mutate([PARITY])).toThrow('cosmic-ray baseline failed (exit 1): the tests must pass on unmutated code:\nBaseline failed');
    expect(io.runs).toHaveLength(1);
  });

  it('cannot run when a cosmic-ray step fails', () => {
    const io = fakeIo((tool, args) => (args[0] === 'exec' ? { status: 2, stdout: '', stderr: 'no session' } : ok()));
    expect(() => pythonAdapter(options, io).mutate([PARITY])).toThrow('cosmic-ray exec exited 2:\nno session');
  });
});

it('accepts a radon function whose report has no closures field', () => {
  expect(parseRadon('{"a.py":[{"type":"function","name":"f","lineno":2,"endline":4,"complexity":1}]}', (path) => path))
    .toEqual([{ file: 'a.py', name: 'f', startLine: 2, endLine: 4, complexity: 1 }]);
});

it('reports unknown coverage versions and keeps only named function regions', () => {
  expect(() => parseCoverage('{"files":{"a.py":{}}}', (path) => path))
    .toThrow(/^coverage\.py \(unknown version\) wrote no function regions for a\.py: install coverage 7\.10 or later$/);
  const json = '{"files":{"a.py":{"functions":{"":{"start_line":1,"executed_lines":[1],"missing_lines":[]},"f":{"start_line":2,"executed_lines":[3],"missing_lines":[4,5]}}}}}';
  const regions = parseCoverage(json, (path) => path);
  expect(regions.get('a.py')).toEqual([{ startLine: 2, executed: [3], missing: [4, 5] }]);
  expect(rowsOf([{ file: 'a.py', name: 'f', startLine: 2, endLine: 5, complexity: 2 }], regions))
    .toEqual([{ file: 'a.py', name: 'f', startLine: 2, endLine: 5, complexity: 2, lines: 3, covered: 1 }]);
});

it('reports just the first line of LF tool output for an untested mutant', () => {
  const work = { mutations: [{ module_path: 'a.py', operator_name: 'core/X', start_pos: [2, 0] }] };
  const result = { worker_outcome: 'normal', test_outcome: 'incompetent', output: 'first\nsecond' };
  expect(() => mutantsOfDump(JSON.stringify([work, result]), (path) => path))
    .toThrow(/^cosmic-ray could not test 1 of 1 mutants \(incompetent: the test command did not run\), first a\.py:2 core\/X: first$/);
});

it('discards a dump entry for a file outside the requested mutation scope', () => {
  const work = { mutations: [{ module_path: GRADES, operator_name: 'core/X', start_pos: [5, 0] }] };
  const result = { worker_outcome: 'normal', test_outcome: 'survived', output: '' };
  const io = fakeIo((tool, args) => tool === 'cosmic-ray' && args[0] === 'dump' ? ok(JSON.stringify([work, result])) : ok(), {}, [], [{ file: PARITY, line: 5 }]);
  expect(pythonAdapter({ ...options, base: 'main' }, io).mutate([PARITY])).toEqual([]);
});

it('trims the edges of a tool error and omits blank streams', () => {
  const io = measured(TESTED, { status: 1, stdout: '  failed', stderr: '', error: new Error('last detail  ') });
  expect(() => pythonAdapter(options, io).coverage([GRADES]))
    .toThrow(/^pytest exited 1; coverage needs a green suite:\nfailed\nlast detail$/);
});

it('writes and reads coverage for distinct source folders through the supported coverage commands', () => {
  const data = join(ROOT, 'tmp-1', '.coverage');
  const report = join(ROOT, 'tmp-1', 'coverage.json');
  const io = fakeIo((tool, args, written) => {
    if (tool === 'radon') return ok(RADON);
    if (JSON.stringify(args) === JSON.stringify(['run', '--data-file', data, '--source', 'src/sample,src/other', '-m', 'pytest', '-q', '-p', 'no:cacheprovider'])) {
      written[data] = TESTED;
      return ok();
    }
    if (JSON.stringify(args) === JSON.stringify(['json', '--data-file', data, '-o', report, '-q']) && written[data] !== undefined) {
      written[report] = written[data];
      return ok();
    }
    return { status: 2, stdout: '', stderr: 'unsupported coverage command' };
  });
  expect(pythonAdapter(options, io).coverage([GRADES, PARITY, 'src/other/items.py'])).toEqual([
    { file: GRADES, name: 'grade', startLine: 4, endLine: 11, lines: 7, covered: 7 },
    { file: GRADES, name: 'Report.grade', startLine: 15, endLine: 16, lines: 1, covered: 1 },
    { file: PARITY, name: 'is_even', startLine: 4, endLine: 5, lines: 1, covered: 1 },
  ]);
});

it('names a missing Python before trying to read a selected file', () => {
  const io = fakeIo(() => ok());
  io.tools.python = () => { throw new Error('Python 3.10 or later was not found'); };
  io.pyFiles = () => { throw new Error('cannot open src'); };
  expect(() => pythonAdapter(options, io).coverage(['src']))
    .toThrow(/^Python 3\.10 or later was not found$/);
});
