import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crapGate, mutationGate } from '../../gates/test-strength/gate.ts';
import { COVERAGE_ARGS, INSTALL, complexityOf, ranDotnet, dotnetAdapter, methodRows, mutantsOf, parseCobertura, parseXml, strykerArgs, type CoberturaLine, type DotnetIo } from './adapter.ts';

// The recorded reports were made on the sample project (fixtures/dotnet-sample) with the
// checkout folder replaced by /work/dotnet-sample; resolve() gives it a drive on Windows.
const ROOT = resolve('/work/dotnet-sample');
const recorded = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const TESTED = recorded('coverage-tested.cobertura.xml');
const UNTESTED = recorded('coverage-untested.cobertura.xml');
const MUTATION = recorded('mutation-report.json');
const GRADES = 'src/Sample/Grades.cs';
const PARITY = 'src/Sample/Parity.cs';
const keyOf = (abs: string) => abs.slice(ROOT.length + 1).split('\\').join('/');

interface Fake extends DotnetIo {
  runs: string[][];
  removed: string[];
}

type Ran = { status: number | null; output: string; missing: boolean };

function fakeIo(files: Record<string, string>, onRun: (args: string[], tmp: string) => Ran = () => ({ status: 0, output: '', missing: false }), found: (dir: string) => string[] = () => []): Fake {
  const tmp = join(ROOT, 'tmp-1');
  const io: Fake = {
    runs: [],
    removed: [],
    read: (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no file ${path}`);
      return text;
    },
    exists: (path) => path in files,
    find: (dir, name) => (name === 'coverage.cobertura.xml' ? found(dir) : []),
    tempDir: () => tmp,
    remove: (dir) => {
      io.removed.push(dir);
    },
    dotnet: (args) => (io.runs.push(args), onRun(args, tmp)),
  };
  return io;
}

const options = (coverageFile?: string) => ({ cwd: ROOT, coverageFile });
const line = (number: number, hits: number, branches = 0, decisions = 0): CoberturaLine => ({ number, hits, branches, decisions });

/** A one-class Cobertura report: `source` and `filename` as coverlet writes them, then the methods' xml. */
const cobertura = (sources: string[], filename: string, methods: string, className = 'Sample.A') =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<coverage line-rate="1">',
    `  <sources>${sources.map((s) => `<source>${s}</source>`).join('')}</sources>`,
    '  <packages><package name="Sample"><classes>',
    `    <class name="${className}" filename="${filename}"><methods>${methods}</methods><lines><line number="99" hits="1" branch="False" /></lines></class>`,
    '  </classes></package></packages>',
    '</coverage>',
  ].join('\n');
const method = (name: string, lines: string) => `<method name="${name}" signature="()" complexity="9"><lines>${lines}</lines></method>`;
const plain = (n: number, hits: number) => `<line number="${n}" hits="${hits}" branch="False" />`;
const SRC = join(ROOT, 'src', 'Sample') + sep;

describe('parseCobertura', () => {
  it("reads coverlet's sources and each method's lines, branches and decision points", () => {
    const report = parseCobertura(UNTESTED);
    expect(report.sources).toEqual(['/work/dotnet-sample/src/Sample/']);
    expect(report.methods).toEqual([
      {
        file: 'Grades.cs',
        className: 'Sample.Grades',
        name: 'Grade',
        signature: '(System.Int32)',
        lines: [line(6, 0), line(7, 0, 2, 1), line(8, 0, 2, 1), line(9, 0, 2, 1), line(10, 0)],
      },
      { file: 'Parity.cs', className: 'Sample.Parity', name: 'IsEven', signature: '(System.Int32)', lines: [line(6, 1), line(7, 1), line(8, 1)] },
    ]);
  });

  it('reads the hits the tests made', () => {
    expect(parseCobertura(TESTED).methods[0]!.lines.map((l) => l.hits)).toEqual([6, 7, 7, 3, 6]);
  });

  it("decodes XML entities in names, as in a compiler-made class's", () => {
    const xml = cobertura(['/s/'], 'A &amp; B.cs', method('MoveNext', plain(3, 1)), 'Sample.A/&lt;RunAsync&gt;d__0 &quot;x&quot; &apos;y&apos;');
    const [m] = parseCobertura(xml).methods;
    expect([m!.file, m!.className]).toEqual(['A & B.cs', `Sample.A/<RunAsync>d__0 "x" 'y'`]);
  });

  it('decodes entities in the sources and trims around them', () => {
    expect(parseCobertura(cobertura([' /a&amp;b/ '], 'A.cs', '')).sources).toEqual(['/a&b/']);
  });

  it('reads a line with conditions written out in full, and a self-closing line with none', () => {
    const lines = '<line number="4" hits="2" branch="True" condition-coverage="75% (3/4)"><conditions><condition number="1" type="jump" coverage="50%" /><condition number="9" type="jump" coverage="100%" /></conditions></line><line number="5" hits="0" branch="False"/>';
    expect(parseCobertura(cobertura(['/s/'], 'A.cs', method('M', lines))).methods[0]!.lines).toEqual([line(4, 2, 4, 2), line(5, 0)]);
  });

  it('reads branch counts of more than one digit', () => {
    const lines = '<line number="4" hits="2" branch="True" condition-coverage="83% (10/12)"><conditions><condition number="1" /></conditions></line>';
    expect(parseCobertura(cobertura(['/s/'], 'A.cs', method('M', lines))).methods[0]!.lines).toEqual([line(4, 2, 12, 1)]);
  });

  it('keeps the methods of every class and package, and no class-level lines', () => {
    const xml = cobertura(['/s/'], 'A.cs', method('M', plain(1, 1)) + method('N', plain(2, 0))).replace('</classes>', '<class name="Sample.B" filename="B.cs"><methods>' + method('O', plain(3, 1)) + '</methods></class></classes>');
    expect(parseCobertura(xml).methods.map((m) => [m.className, m.name, m.lines.length])).toEqual([
      ['Sample.A', 'M', 1],
      ['Sample.A', 'N', 1],
      ['Sample.B', 'O', 1],
    ]);
  });
});

describe('parseXml', () => {
  it('gives a nameless root holding the elements, their decoded attributes, children and text', () => {
    expect(parseXml('<a k="&lt;1" n="2">x<b/>y<c>z</c></a>')).toEqual({
      name: '',
      attrs: {},
      children: [
        {
          name: 'a',
          attrs: { k: '<1', n: '2' },
          children: [
            { name: 'b', attrs: {}, children: [], text: '' },
            { name: 'c', attrs: {}, children: [], text: 'z' },
          ],
          text: 'xy',
        },
      ],
      text: '',
    });
  });
});

describe('complexityOf', () => {
  it('is 1 plus each decision point\'s branches beyond the first, the way McCabe counts', () => {
    expect(complexityOf(parseCobertura(TESTED).methods[0]!.lines)).toBe(4);
    expect(complexityOf([line(1, 1)])).toBe(1);
  });

  it('counts a && b on one line as two decisions, and a switch by its targets', () => {
    expect(complexityOf([line(1, 1, 4, 2)])).toBe(3);
    expect(complexityOf([line(1, 1, 4, 1), line(2, 1, 2, 1)])).toBe(5);
  });
});

describe('methodRows', () => {
  it("gives each method of a named file its lines, the ones the tests ran, and its complexity", () => {
    expect(methodRows([parseCobertura(UNTESTED)], [GRADES, PARITY], keyOf)).toEqual([
      { file: GRADES, name: 'Sample.Grades.Grade', startLine: 6, endLine: 10, lines: 5, covered: 0, complexity: 4 },
      { file: PARITY, name: 'Sample.Parity.IsEven', startLine: 6, endLine: 8, lines: 3, covered: 3, complexity: 1 },
    ]);
  });

  it('leaves out files that were not named', () => {
    expect(methodRows([parseCobertura(TESTED)], [PARITY], keyOf).map((r) => r.name)).toEqual(['Sample.Parity.IsEven']);
  });

  it('adds up the runs of several test projects, line by line', () => {
    const a = parseCobertura(cobertura([SRC], 'A.cs', method('M', plain(1, 1) + plain(2, 0) + plain(3, 0))));
    const b = parseCobertura(cobertura([SRC], 'A.cs', method('M', plain(1, 0) + plain(2, 4) + plain(3, 0))));
    expect(methodRows([a, b], ['src/Sample/A.cs'], keyOf)).toEqual([{ file: 'src/Sample/A.cs', name: 'Sample.A.M', startLine: 1, endLine: 3, lines: 3, covered: 2, complexity: 1 }]);
  });

  it('keeps apart methods that share a name but not a signature or a class', () => {
    const one = parseCobertura(cobertura([SRC], 'A.cs', method('M', plain(1, 1))));
    const other = parseCobertura(cobertura([SRC], 'A.cs', method('M', plain(5, 0)).replace('signature="()"', 'signature="(int)"')));
    const third = parseCobertura(cobertura([SRC], 'A.cs', method('M', plain(9, 0)), 'Sample.B'));
    expect(methodRows([one, other, third], ['src/Sample/A.cs'], keyOf).map((r) => [r.name, r.startLine])).toEqual([
      ['Sample.A.M', 1],
      ['Sample.A.M', 5],
      ['Sample.B.M', 9],
    ]);
  });

  it('keeps a line only one of the runs has', () => {
    const a = parseCobertura(cobertura([SRC], 'A.cs', method('M', plain(1, 1))));
    const b = parseCobertura(cobertura([SRC], 'A.cs', method('M', plain(1, 0) + plain(2, 3))));
    expect(methodRows([a, b], ['src/Sample/A.cs'], keyOf)).toEqual([{ file: 'src/Sample/A.cs', name: 'Sample.A.M', startLine: 1, endLine: 2, lines: 2, covered: 2, complexity: 1 }]);
  });

  it('keeps apart a class and method whose names only run together the same', () => {
    const one = parseCobertura(cobertura([SRC], 'A.cs', method('XY', plain(1, 1)), 'W'));
    const other = parseCobertura(cobertura([SRC], 'A.cs', method('Y', plain(5, 0)), 'WX'));
    expect(methodRows([one, other], ['src/Sample/A.cs'], keyOf).map((r) => [r.name, r.startLine])).toEqual([
      ['W.XY', 1],
      ['WX.Y', 5],
    ]);
  });

  it("keeps a decision point's branches when another run adds the same line", () => {
    const branchy = '<line number="2" hits="1" branch="True" condition-coverage="50% (1/2)"><conditions><condition number="1" /></conditions></line>';
    const a = parseCobertura(cobertura([SRC], 'A.cs', method('M', branchy)));
    expect(methodRows([a, a], ['src/Sample/A.cs'], keyOf)[0]).toMatchObject({ complexity: 2, lines: 1, covered: 1 });
  });

  it('finds a file under whichever source holds it, and takes an absolute filename as it is', () => {
    const several = parseCobertura(cobertura([join(ROOT, 'lib') + sep, SRC], 'A.cs', method('M', plain(1, 1))));
    const absolute = parseCobertura(cobertura([join(ROOT, 'lib') + sep], join(ROOT, 'src', 'Sample', 'B.cs'), method('M', plain(1, 1))));
    expect(methodRows([several, absolute], ['src/Sample/A.cs', 'src/Sample/B.cs'], keyOf).map((r) => r.file)).toEqual(['src/Sample/A.cs', 'src/Sample/B.cs']);
  });

  it('skips a method with no lines', () => {
    expect(methodRows([parseCobertura(cobertura([SRC], 'A.cs', method('M', '')))], ['src/Sample/A.cs'], keyOf)).toEqual([]);
  });
});

describe('mutantsOf', () => {
  it("reads Stryker.NET's json report: each mutant of a named file with its line, mutator and status", () => {
    expect(mutantsOf(JSON.parse(MUTATION), [PARITY], keyOf)).toEqual([
      { file: PARITY, line: 6, mutator: 'Block removal mutation', status: 'Ignored' },
      { file: PARITY, line: 7, mutator: 'Equality mutation', status: 'Killed' },
      { file: PARITY, line: 7, mutator: 'Arithmetic mutation', status: 'Survived' },
    ]);
  });

  it('leaves out the files Stryker.NET filtered away', () => {
    expect(mutantsOf(JSON.parse(MUTATION), [GRADES], keyOf)).toHaveLength(15);
    expect(mutantsOf(JSON.parse(MUTATION), ['src/Other.cs'], keyOf)).toEqual([]);
  });
});

describe('the commands', () => {
  it('runs the tests once with coverlet writing Cobertura into a folder', () => {
    expect(COVERAGE_ARGS('d')).toEqual(['test', '--collect', 'XPlat Code Coverage', '--results-directory', 'd']);
  });

  it('runs Stryker.NET with a json report into a folder, mutating exactly the named files wherever the project sits', () => {
    expect(strykerArgs('d', ['src/A.cs', 'src/B.cs'])).toEqual(['stryker', '--reporter', 'json', '--output', 'd', '--mutate', '**/src/A.cs', '--mutate', '**/src/B.cs']);
  });
});

describe('dotnetAdapter coverage and complexity', () => {
  const tmp = join(ROOT, 'tmp-1');
  const ranGreen = (reports: Record<string, string>) =>
    fakeIo(
      reports,
      () => ({ status: 0, output: 'Passed!', missing: false }),
      (dir) => Object.keys(reports).filter((p) => p.startsWith(dir)),
    );

  it('runs dotnet test once for both, reads every Cobertura file it wrote, and removes the folder', () => {
    const io = ranGreen({ [join(tmp, 'g1', 'coverage.cobertura.xml')]: UNTESTED });
    const adapter = dotnetAdapter(options(), io);
    expect(adapter.complexity([GRADES]).map(({ name, complexity, startLine, endLine }) => [name, complexity, startLine, endLine])).toEqual([['Sample.Grades.Grade', 4, 6, 10]]);
    expect(adapter.coverage([GRADES])).toEqual([{ file: GRADES, name: 'Sample.Grades.Grade', startLine: 6, endLine: 10, lines: 5, covered: 0 }]);
    expect(io.runs).toEqual([COVERAGE_ARGS(tmp)]);
    expect(io.removed).toEqual([tmp]);
  });

  it('runs again for other paths', () => {
    const io = ranGreen({ [join(tmp, 'g1', 'coverage.cobertura.xml')]: UNTESTED });
    const adapter = dotnetAdapter(options(), io);
    adapter.complexity([GRADES]);
    expect(adapter.coverage([PARITY])).toMatchObject([{ name: 'Sample.Parity.IsEven', covered: 3 }]);
    expect(io.runs).toHaveLength(2);
  });

  it('merges the reports of several test projects', () => {
    const io = ranGreen({ [join(tmp, 'g1', 'coverage.cobertura.xml')]: UNTESTED, [join(tmp, 'g2', 'coverage.cobertura.xml')]: TESTED });
    expect(dotnetAdapter(options(), io).coverage([GRADES])).toMatchObject([{ lines: 5, covered: 5 }]);
  });

  it('reads a Cobertura file the project already made instead of running anything', () => {
    const io = fakeIo({ [join(ROOT, 'cov.xml')]: TESTED });
    expect(dotnetAdapter(options('cov.xml'), io).coverage([GRADES])).toMatchObject([{ lines: 5, covered: 5 }]);
    expect(io.runs).toEqual([]);
  });

  it('refuses coverage from a red suite, with the output, and still removes the folder', () => {
    const io = fakeIo({}, () => ({ status: 1, output: 'Failed!', missing: false }));
    expect(() => dotnetAdapter(options(), io).coverage([GRADES])).toThrow('dotnet test exited 1; coverage needs a green suite:\nFailed!');
    expect(io.removed).toEqual([tmp]);
  });

  it('refuses a run that wrote no Cobertura file', () => {
    const io = ranGreen({});
    expect(() => dotnetAdapter(options(), io).coverage([GRADES])).toThrow('dotnet test wrote no coverage.cobertura.xml: does every test project reference coverlet.collector?\nPassed!');
  });

  it('refuses a named file the coverage never saw, rather than scoring nothing', () => {
    const io = fakeIo({ [join(ROOT, 'cov.xml')]: TESTED });
    expect(() => dotnetAdapter(options('cov.xml'), io).complexity([PARITY, 'src/Other.cs'])).toThrow('the coverage has no method in src/Other.cs: is it in a project the tests reference?');
  });

  it('names every file the coverage never saw', () => {
    const io = fakeIo({ [join(ROOT, 'cov.xml')]: TESTED });
    expect(() => dotnetAdapter(options('cov.xml'), io).complexity(['src/Other.cs', 'src/More.cs'])).toThrow('the coverage has no method in src/Other.cs, src/More.cs: is it');
  });

  it('runs again for paths that only join up the same', () => {
    const io = ranGreen({ [join(tmp, 'g1', 'coverage.cobertura.xml')]: UNTESTED });
    const adapter = dotnetAdapter(options(), io);
    adapter.complexity([GRADES, PARITY]);
    expect(() => adapter.complexity([GRADES + PARITY])).toThrow(`no method in ${GRADES + PARITY}`);
    expect(io.runs).toHaveLength(2);
  });

  it('says what to install when there is no dotnet', () => {
    const io = fakeIo({}, () => ({ status: null, output: 'spawnSync dotnet ENOENT', missing: true }));
    expect(() => dotnetAdapter(options(), io).complexity([GRADES])).toThrow(INSTALL);
  });
});

describe('dotnetAdapter.mutate', () => {
  const tmp = join(ROOT, 'tmp-1');

  it('runs Stryker.NET into a temp folder, reads its json report, keeps the named files and removes the folder', () => {
    const io = fakeIo({ [join(tmp, 'reports', 'mutation-report.json')]: MUTATION });
    const mutants = dotnetAdapter(options(), io).mutate([PARITY]);
    expect(mutants.map((m) => m.status)).toEqual(['Ignored', 'Killed', 'Survived']);
    expect(io.runs).toEqual([strykerArgs(tmp, [PARITY])]);
    expect(io.removed).toEqual([tmp]);
  });

  it('fails with the output when Stryker.NET wrote no report', () => {
    const io = fakeIo({}, () => ({ status: 1, output: 'Could not execute', missing: false }));
    expect(() => dotnetAdapter(options(), io).mutate([PARITY])).toThrow('Stryker.NET wrote no report (restore it with `dotnet tool restore`):\nCould not execute');
    expect(io.removed).toEqual([tmp]);
  });

  it('says what to install when there is no dotnet', () => {
    const io = fakeIo({}, () => ({ status: null, output: '', missing: true }));
    expect(() => dotnetAdapter(options(), io).mutate([PARITY])).toThrow(INSTALL);
  });
});

describe('the gates on the recorded reports', () => {
  it('crap: fails the untested branchy method at 4^2 + 4 = 20 and passes the covered simple one', () => {
    const result = crapGate([GRADES, PARITY], dotnetAdapter(options('cov.xml'), fakeIo({ [join(ROOT, 'cov.xml')]: UNTESTED })));
    expect(result).toMatchObject({ pass: false, functions: 2, over: [{ name: 'Sample.Grades.Grade', complexity: 4, coverage: 0, crap: 20 }] });
  });

  it('crap: passes once the method is tested', () => {
    expect(crapGate([GRADES, PARITY], dotnetAdapter(options('cov.xml'), fakeIo({ [join(ROOT, 'cov.xml')]: TESTED })))).toMatchObject({ pass: true, functions: 2 });
  });

  it('mutation: fails on the mutant the weak test left standing', () => {
    const io = fakeIo({ [join(ROOT, 'tmp-1', 'reports', 'mutation-report.json')]: MUTATION });
    expect(mutationGate([PARITY], dotnetAdapter(options(), io))).toMatchObject({ pass: false, mutants: 3, standing: [{ file: PARITY, line: 7, mutator: 'Arithmetic mutation', status: 'Survived' }] });
  });
});

describe('ranDotnet', () => {
  it('joins the output and reports a run that started', () => {
    expect(ranDotnet({ status: 1, stdout: 'out ', stderr: 'err' })).toEqual({ status: 1, output: 'out err', missing: false });
  });

  it('reports dotnet missing when it could not be found to start', () => {
    const error = Object.assign(new Error('spawnSync dotnet ENOENT'), { code: 'ENOENT' });
    expect(ranDotnet({ status: null, stdout: '', stderr: '', error })).toEqual({ status: null, output: 'spawnSync dotnet ENOENT', missing: true });
  });

  it('keeps any other start failure a failed run, not a missing toolchain', () => {
    const error = Object.assign(new Error('spawnSync dotnet EACCES'), { code: 'EACCES' });
    expect(ranDotnet({ status: null, error })).toEqual({ status: null, output: 'spawnSync dotnet EACCES', missing: false });
  });
});

describe('INSTALL', () => {
  it('names the SDK, PATH and the tool restore', () => {
    expect(INSTALL).toBe('dotnet was not found: install the .NET SDK 8 or later (https://dotnet.microsoft.com/download), put dotnet on PATH, and run `dotnet tool restore` in the project for Stryker.NET');
  });
});
