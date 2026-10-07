import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BINS, coverageArgs, functionLines, jsTsAdapter, strykerConfig, type JsTsIo, type Tool } from './adapter.ts';

const ROOT = resolve('/work/app');
const SOURCE = ['export function sign(n: number): number {', '  if (n > 0) return 1;', '  return n < 0 ? -1 : 0;', '}', ''].join('\n');
const NESTED = ['export function outer(xs: number[]) {', '  const a = 1;', '  return xs.map((x) => {', '    return x + a;', '  });', '}', ''].join('\n');

const stmt = (line: number) => ({ start: { line }, end: { line } });

interface Fake extends JsTsIo {
  runs: Array<[Tool, string[]]>;
  written: Record<string, string>;
  removed: string[];
}

function fakeIo(files: Record<string, string>, onRun: (tool: Tool, args: string[], io: Fake) => { status: number | null; output: string } = () => ({ status: 0, output: '' })): Fake {
  const io: Fake = {
    runs: [],
    written: {},
    removed: [],
    read: (path) => {
      const text = io.written[path] ?? files[path];
      if (text === undefined) throw new Error(`no file ${path}`);
      return text;
    },
    exists: (path) => path in io.written || path in files,
    write: (path, text) => {
      io.written[path] = text;
    },
    tempDir: () => join(ROOT, 'tmp-1'),
    remove: (dir) => {
      io.removed.push(dir);
    },
    runBin: (tool, args) => (io.runs.push([tool, args]), onRun(tool, args, io)),
  };
  return io;
}

const COVERAGE = JSON.stringify({
  [join(ROOT, 'src', 'sign.ts')]: { statementMap: { 0: stmt(2), 1: stmt(2), 2: stmt(3) }, s: { 0: 1, 1: 0, 2: 0 } },
});

describe('functionLines', () => {
  it("counts a function's own lines and the lines the tests ran", () => {
    const fns = [{ file: 'src/sign.ts', name: 'sign', startLine: 1, endLine: 4, complexity: 3 }];
    expect(functionLines(fns, { statementMap: { 0: stmt(2), 1: stmt(2), 2: stmt(3), 3: stmt(9) }, s: { 0: 0, 1: 4, 2: 0, 3: 1 } })).toEqual([
      { file: 'src/sign.ts', name: 'sign', startLine: 1, endLine: 4, lines: 2, covered: 1 },
    ]);
  });

  it('gives a nested function its own lines, never its parent', () => {
    const fns = [
      { file: 'f.ts', name: 'outer', startLine: 1, endLine: 6, complexity: 1 },
      { file: 'f.ts', name: 'inner', startLine: 3, endLine: 5, complexity: 1 },
    ];
    const lines = functionLines(fns, { statementMap: { 0: stmt(1), 1: stmt(3), 2: stmt(4), 3: stmt(6) }, s: { 0: 1, 1: 1, 2: 0, 3: 1 } });
    expect(lines.map(({ name, lines, covered }) => [name, lines, covered])).toEqual([
      ['outer', 2, 2],
      ['inner', 2, 1],
    ]);
  });

  it('reads a line as run when any statement on it ran, and a statement with no count as not run', () => {
    const fns = [{ file: 'f.ts', name: 'f', startLine: 1, endLine: 3, complexity: 1 }];
    expect(functionLines(fns, { statementMap: { 0: stmt(1), 1: stmt(2) }, s: { 0: 1 } })[0]).toMatchObject({ lines: 2, covered: 1 });
  });

  it('nests a function that starts on the same line as its parent', () => {
    const fns = [
      { file: 'f.ts', name: 'outer', startLine: 1, endLine: 6, complexity: 1 },
      { file: 'f.ts', name: 'inner', startLine: 1, endLine: 3, complexity: 1 },
    ];
    expect(functionLines(fns, { statementMap: { 0: stmt(2), 1: stmt(5) }, s: { 0: 1, 1: 1 } }).map((l) => l.lines)).toEqual([1, 1]);
  });

  it('nests a function that ends on the same line as its parent', () => {
    const fns = [
      { file: 'f.ts', name: 'outer', startLine: 1, endLine: 6, complexity: 1 },
      { file: 'f.ts', name: 'inner', startLine: 4, endLine: 6, complexity: 1 },
    ];
    expect(functionLines(fns, { statementMap: { 0: stmt(2), 1: stmt(5) }, s: { 0: 1, 1: 1 } }).map((l) => l.lines)).toEqual([1, 1]);
  });

  it('never nests a function that starts before or ends after the other', () => {
    const fns = [
      { file: 'f.ts', name: 'a', startLine: 2, endLine: 6, complexity: 1 },
      { file: 'f.ts', name: 'starts-before', startLine: 1, endLine: 4, complexity: 1 },
      { file: 'f.ts', name: 'ends-after', startLine: 4, endLine: 7, complexity: 1 },
    ];
    expect(functionLines(fns, { statementMap: { 0: stmt(3), 1: stmt(5) }, s: { 0: 1, 1: 1 } }).map((l) => l.lines)).toEqual([2, 1, 1]);
  });

  it('counts statements on the first and last line of a function', () => {
    const fns = [{ file: 'f.ts', name: 'f', startLine: 2, endLine: 4, complexity: 1 }];
    expect(functionLines(fns, { statementMap: { 0: stmt(1), 1: stmt(2), 2: stmt(4), 3: stmt(5) }, s: { 0: 1, 1: 1, 2: 1, 3: 1 } })[0]).toMatchObject({ lines: 2, covered: 2 });
  });
});

describe('BINS', () => {
  it("names each tool's package and the JS entry of its bin", () => {
    expect(BINS).toEqual({
      vitest: ['vitest', 'vitest.mjs'],
      jest: ['jest', 'bin/jest.js'],
      karma: ['karma', 'bin/karma'],
      stryker: ['@stryker-mutator/core', 'bin/stryker.js'],
    });
  });
});

describe('coverageArgs', () => {
  it('runs vitest once with v8 coverage as istanbul json, limited to the named files', () => {
    expect(coverageArgs('vitest', 'd', ['src/a.ts', 'src/b.ts'])).toEqual([
      'run',
      '--coverage.enabled',
      '--coverage.provider=v8',
      '--coverage.reporter=json',
      '--coverage.reportsDirectory=d',
      '--coverage.include=src/a.ts',
      '--coverage.include=src/b.ts',
    ]);
  });

  it('runs jest once with json coverage collected from the named files', () => {
    expect(coverageArgs('jest', 'd', ['src/a.ts'])).toEqual(['--ci', '--coverage', '--coverageReporters=json', '--coverageDirectory=d', '--collectCoverageFrom=src/a.ts']);
  });

  it('has no command for karma: its coverage comes from the project config', () => {
    expect(() => coverageArgs('karma', 'd', ['src/a.ts'])).toThrow(/karma: run karma with karma-coverage's json reporter and pass its coverage-final.json with --coverage/);
  });
});

describe('strykerConfig', () => {
  it('mutates exactly the named files with the chosen runner, per-test coverage and a json report', () => {
    expect(strykerConfig('vitest', ['src/a.ts'], 'd')).toEqual({
      testRunner: 'vitest',
      mutate: ['src/a.ts'],
      coverageAnalysis: 'perTest',
      reporters: ['json'],
      jsonReporter: { fileName: join('d', 'mutation.json') },
      tempDirName: join('d', 'stryker-tmp'),
      cleanTempDir: true,
    });
  });

  it("runs jest as a custom project with the project's own jest config", () => {
    expect(strykerConfig('jest', ['src/a.ts'], 'd')).toMatchObject({ testRunner: 'jest', jest: { projectType: 'custom' } });
  });

  it('runs karma with the project karma.conf', () => {
    expect(strykerConfig('karma', ['src/a.ts'], 'd')).toMatchObject({ testRunner: 'karma', karma: { configFile: 'karma.conf.js' } });
  });
});

describe('jsTsAdapter.complexity', () => {
  it('measures each function of each named file, relative to the project', () => {
    const io = fakeIo({ [join(ROOT, 'src', 'sign.ts')]: SOURCE, [join(ROOT, 'src', 'nested.ts')]: NESTED });
    const scores = jsTsAdapter({ runner: 'vitest', cwd: ROOT, coverageFile: undefined }, io).complexity(['src/sign.ts', 'src/nested.ts']);
    expect(scores.map(({ file, name, complexity }) => [file, name, complexity])).toEqual([
      ['src/sign.ts', 'sign', 3],
      ['src/nested.ts', 'outer', 1],
      ['src/nested.ts', '(anonymous):3', 1],
    ]);
    expect(scores[0]).toMatchObject({ startLine: 1, endLine: 4 });
  });
});

describe('jsTsAdapter.coverage', () => {
  it('runs the runner into a temp folder, reads its istanbul json, and removes the folder', () => {
    const tmp = join(ROOT, 'tmp-1');
    const io = fakeIo({ [join(ROOT, 'src', 'sign.ts')]: SOURCE }, (_tool, _args, self) => {
      self.write(join(tmp, 'coverage-final.json'), COVERAGE);
      return { status: 0, output: '' };
    });
    const lines = jsTsAdapter({ runner: 'jest', cwd: ROOT, coverageFile: undefined }, io).coverage(['src/sign.ts']);
    expect(lines).toEqual([{ file: 'src/sign.ts', name: 'sign', startLine: 1, endLine: 4, lines: 2, covered: 1 }]);
    expect(io.runs).toEqual([['jest', coverageArgs('jest', tmp, ['src/sign.ts'])]]);
    expect(io.removed).toEqual([tmp]);
  });

  it('reads a coverage file the project already made instead of running anything', () => {
    const io = fakeIo({ [join(ROOT, 'src', 'sign.ts')]: SOURCE, [join(ROOT, 'cov.json')]: COVERAGE });
    const lines = jsTsAdapter({ runner: 'karma', cwd: ROOT, coverageFile: 'cov.json' }, io).coverage(['src/sign.ts']);
    expect(lines).toMatchObject([{ name: 'sign', lines: 2, covered: 1 }]);
    expect(io.runs).toEqual([]);
  });

  it('reads each named file against its own coverage', () => {
    const coverage = JSON.stringify({
      [join(ROOT, 'src', 'sign.ts')]: { statementMap: { 0: stmt(2) }, s: { 0: 1 } },
      [join(ROOT, 'src', 'nested.ts')]: { statementMap: { 0: stmt(2), 1: stmt(4) }, s: { 0: 0, 1: 1 } },
    });
    const io = fakeIo({ [join(ROOT, 'src', 'sign.ts')]: SOURCE, [join(ROOT, 'src', 'nested.ts')]: NESTED, [join(ROOT, 'cov.json')]: coverage });
    const lines = jsTsAdapter({ runner: 'vitest', cwd: ROOT, coverageFile: 'cov.json' }, io).coverage(['src/sign.ts', 'src/nested.ts']);
    expect(lines.map(({ file, name, lines, covered }) => [file, name, lines, covered])).toEqual([
      ['src/sign.ts', 'sign', 1, 1],
      ['src/nested.ts', 'outer', 1, 0],
      ['src/nested.ts', '(anonymous):3', 1, 1],
    ]);
  });

  it('leaves out a file the coverage never saw, so the gate scores it untested', () => {
    const io = fakeIo({ [join(ROOT, 'src', 'other.ts')]: SOURCE, [join(ROOT, 'cov.json')]: COVERAGE });
    expect(jsTsAdapter({ runner: 'vitest', cwd: ROOT, coverageFile: 'cov.json' }, io).coverage(['src/other.ts'])).toEqual([]);
  });

  it('refuses coverage from a red suite, with the runner output, and still removes the folder', () => {
    const io = fakeIo({ [join(ROOT, 'src', 'sign.ts')]: SOURCE }, () => ({ status: 1, output: '1 failed' }));
    expect(() => jsTsAdapter({ runner: 'vitest', cwd: ROOT, coverageFile: undefined }, io).coverage(['src/sign.ts'])).toThrow(
      'vitest exited 1; coverage needs a green suite:\n1 failed',
    );
    expect(io.removed).toEqual([join(ROOT, 'tmp-1')]);
  });

  it('refuses a runner that was killed', () => {
    const io = fakeIo({ [join(ROOT, 'src', 'sign.ts')]: SOURCE }, () => ({ status: null, output: '' }));
    expect(() => jsTsAdapter({ runner: 'jest', cwd: ROOT, coverageFile: undefined }, io).coverage(['src/sign.ts'])).toThrow('jest exited null');
  });
});

describe('jsTsAdapter.mutate', () => {
  const report = JSON.stringify({
    files: {
      [join(ROOT, 'src', 'sign.ts')]: {
        mutants: [
          { location: { start: { line: 2 } }, mutatorName: 'ConditionalExpression', status: 'Killed' },
          { location: { start: { line: 3 } }, mutatorName: 'UnaryOperator', status: 'Survived' },
        ],
      },
      'src/other.ts': { mutants: [{ location: { start: { line: 1 } }, mutatorName: 'StringLiteral', status: 'NoCoverage' }] },
    },
  });

  it('writes a Stryker config, runs Stryker on it, reads the json report and removes the folder', () => {
    const tmp = join(ROOT, 'tmp-1');
    const io = fakeIo({}, (_tool, _args, self) => {
      self.write(join(tmp, 'mutation.json'), report);
      // Stryker exits non-zero when mutants survive: that is a verdict, not a crash.
      return { status: 1, output: '' };
    });
    const mutants = jsTsAdapter({ runner: 'jest', cwd: ROOT, coverageFile: undefined }, io).mutate(['src/sign.ts']);
    expect(mutants).toEqual([
      { file: 'src/sign.ts', line: 2, mutator: 'ConditionalExpression', status: 'Killed' },
      { file: 'src/sign.ts', line: 3, mutator: 'UnaryOperator', status: 'Survived' },
      { file: 'src/other.ts', line: 1, mutator: 'StringLiteral', status: 'NoCoverage' },
    ]);
    expect(io.runs).toEqual([['stryker', ['run', join(tmp, 'stryker.json')]]]);
    expect(JSON.parse(io.written[join(tmp, 'stryker.json')]!)).toEqual(strykerConfig('jest', ['src/sign.ts'], tmp));
    expect(io.removed).toEqual([tmp]);
  });

  it('fails with the Stryker output when it wrote no report', () => {
    const io = fakeIo({}, () => ({ status: 1, output: 'boom' }));
    expect(() => jsTsAdapter({ runner: 'vitest', cwd: ROOT, coverageFile: undefined }, io).mutate(['src/sign.ts'])).toThrow('Stryker wrote no report:\nboom');
    expect(io.removed).toEqual([join(ROOT, 'tmp-1')]);
  });
});
