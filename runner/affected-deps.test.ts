import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { affectedBy, emitsCode, cruiseGraph, graphFiles, runtimeDeps, textDeps, treeOf, withDeps, type Graph } from './affected-deps.ts';

// dependency-cruiser's JSON for a toy repo, recorded with config/dependency-cruiser.cjs.
const RECORDED = readFileSync(join(import.meta.dirname, '..', 'test', 'fixtures', 'affected-tests', 'cruise.json'), 'utf8');

describe('treeOf — the repo files and their folders', () => {
  it('lists each file under every folder two levels deep or more', () => {
    const tree = treeOf(['a.json', 'test/b.ts', 'test/fixtures/c/d.json', 'test/fixtures/e.json']);
    expect([...tree.files]).toEqual(['a.json', 'test/b.ts', 'test/fixtures/c/d.json', 'test/fixtures/e.json']);
    expect(Object.fromEntries(tree.dirs)).toEqual({ 'test/fixtures': ['test/fixtures/c/d.json', 'test/fixtures/e.json'], 'test/fixtures/c': ['test/fixtures/c/d.json'] });
  });
});

describe('cruiseGraph — the imports that run, from dependency-cruiser', () => {
  it('reads the recorded output: local imports kept; Node modules and type-only imports left out', () => {
    const graph = cruiseGraph(RECORDED) as Graph;
    expect(graph.get('gates/mid.ts')).toEqual(['gates/low.ts']);
    expect(graph.get('scripts/cli.ts')).toEqual(['gates/top.ts']);
    expect(graph.get('gates/other.ts')).toEqual([]);
    expect(graph.get('test/helpers/help.ts')).toEqual([]);
  });

  it('leaves out unresolved imports and anything in node_modules', () => {
    const json = JSON.stringify({
      modules: [
        { source: 'a.ts', dependencies: [{ resolved: 'gone', couldNotResolve: true }, { resolved: 'node_modules/x/index.js' }, { resolved: 'b.ts', dependencyTypes: ['local', 'import'] }] },
        { source: 'node_modules/x/index.js', dependencies: [] },
        { source: 'b.ts' },
      ],
    });
    expect(cruiseGraph(json)).toEqual(new Map([['a.ts', ['b.ts']], ['b.ts', []]]));
  });

  it('says why when there is no graph', () => {
    expect(cruiseGraph(undefined)).toBe('dependency-cruiser gave no JSON');
    expect(cruiseGraph('{"modules": 3}')).toBe('dependency-cruiser listed no modules');
    expect(cruiseGraph('null')).toBe('dependency-cruiser gave no JSON');
  });
});

// Built in each test, not at load: a fault in treeOf then fails the tests rather than the file.
const tree = () =>
  treeOf(['scripts/cli.ts', 'scripts/cli.test.ts', 'gates/onkel/run.ts', 'test/fixtures/x/a.json', 'test/fixtures/x/b.json', 'config/self-gate.json', 'package.json']);

describe('runtimeDeps — what a file names in its strings', () => {
  it('a CLI spawned by path, its segments joined from the root or from the file', () => {
    expect(runtimeDeps('scripts/cli.test.ts', "spawnSync(process.execPath, [join(ROOT, 'scripts', 'cli.ts')]);", tree())).toEqual(['scripts/cli.ts']);
    expect(runtimeDeps('scripts/cli.test.ts', "const CLI = join(import.meta.dirname, '..', 'gates', 'onkel', 'run.ts');", tree())).toEqual(['gates/onkel/run.ts']);
    expect(runtimeDeps('scripts/cli.test.ts', "run(['gates/onkel/run.ts', '--base']);", tree())).toEqual(['gates/onkel/run.ts']);
    expect(runtimeDeps('scripts/x.test.ts', "spawn(join(import.meta.dirname, 'cli.ts'));", tree())).toEqual(['scripts/cli.ts']);
  });

  it('a fixture folder read at run time: every file in it', () => {
    expect(runtimeDeps('scripts/x.test.ts', "readdirSync(join(REPO, 'test', 'fixtures', 'x'));", tree())).toEqual(['test/fixtures/x/a.json', 'test/fixtures/x/b.json']);
    expect(runtimeDeps('scripts/x.test.ts', 'read(`config/self-gate.json`);', tree())).toEqual(['config/self-gate.json']);
  });

  it('Windows separators, and the file itself, the root folder and names outside the repo left out', () => {
    expect(runtimeDeps('scripts/x.test.ts', "read('scripts\\\\cli.ts');", tree())).toEqual(['scripts/cli.ts']);
    expect(runtimeDeps('test/fixtures/x/c.test.ts', "join(dir, '.'); f(''); g('..'); h('/');", tree())).toEqual([]);
    expect(runtimeDeps('scripts/cli.ts', "read('scripts/cli.ts'); join(ROOT, '..', '.'); f('', '.'); g('/', ''); h('nothing/here.ts', `${x}/a`);", tree())).toEqual([]);
  });

  it('breaks a run of literals at a value that is not one', () => {
    expect(runtimeDeps('a.ts', "join('test', dir, 'fixtures');", tree())).toEqual([]);
    expect(runtimeDeps('a.ts', "join('test', 'fixtures', dir, 'x');", treeOf(['test/fixtures/a/b.ts']))).toEqual(['test/fixtures/a/b.ts']);
  });

  it('names each file once, sorted', () => {
    expect(runtimeDeps('a.ts', "f('scripts/cli.ts'); g('package.json', 'config/self-gate.json'); h('scripts/cli.ts');", tree())).toEqual(['config/self-gate.json', 'package.json', 'scripts/cli.ts']);
  });
});

describe('textDeps — the files a settings file names', () => {
  it('the hook scripts, not other text or itself', () => {
    const settings = '{"hooks":{"Stop":[{"command":"node scripts/cli.ts"}],"x":"node $DIR/gates/onkel/run.ts --y not/here.ts"}}';
    expect(textDeps('.claude/settings.json', settings, tree())).toEqual(['gates/onkel/run.ts', 'scripts/cli.ts']);
    expect(textDeps('scripts/cli.ts', 'scripts/cli.ts', tree())).toEqual([]);
    expect(textDeps('a.json', '{}', tree())).toEqual([]);
  });
});

describe('withDeps, graphFiles and affectedBy', () => {
  const graph: Graph = new Map([
    ['a.ts', ['b.ts']],
    ['b.ts', ['c.ts']],
    ['c.ts', []],
    ['t.test.ts', ['a.ts']],
  ]);

  it('adds the run-time edges beside the imports, each once', () => {
    const merged = withDeps(graph, new Map([['a.ts', ['b.ts', 'x.json']], ['s.test.ts', ['c.ts']]]));
    expect(merged.get('a.ts')).toEqual(['b.ts', 'x.json']);
    expect(merged.get('s.test.ts')).toEqual(['c.ts']);
    expect(graph.get('a.ts')).toEqual(['b.ts']);
  });

  it('knows every module and every dependency', () => {
    expect([...graphFiles(new Map([['a.ts', ['x.json']]]))]).toEqual(['a.ts', 'x.json']);
  });

  it('walks up from the changed files, through every importer, each once', () => {
    expect([...affectedBy(['c.ts'], graph)].sort()).toEqual(['a.ts', 'b.ts', 'c.ts', 't.test.ts']);
    expect([...affectedBy(['a.ts'], graph)].sort()).toEqual(['a.ts', 't.test.ts']);
    const diamond: Graph = new Map([['t.ts', ['l.ts', 'r.ts']], ['l.ts', ['d.ts']], ['r.ts', ['d.ts']]]);
    expect([...affectedBy(['d.ts'], diamond)].sort()).toEqual(['d.ts', 'l.ts', 'r.ts', 't.ts']);
    expect([...affectedBy([], graph)]).toEqual([]);
    const cycle: Graph = new Map([['a.ts', ['b.ts']], ['b.ts', ['a.ts']], ['t.test.ts', ['a.ts']]]);
    expect([...affectedBy(['b.ts'], cycle)].sort()).toEqual(['a.ts', 'b.ts', 't.test.ts']);
  });
});

describe('emitsCode — whether a source has anything a test could run', () => {
  it('is false for a file of types, comments and type-only imports', () => {
    const types = "// The records.\nimport type { X } from './x.ts';\nexport type A = { kind: 'a'; x: X };\nexport interface B {\n  b: string;\n}\n";
    expect(emitsCode(types)).toBe(false);
  });

  it('is true for a value, a function or a side effect', () => {
    expect(emitsCode('export const A = 1;\n')).toBe(true);
    expect(emitsCode('export function f(): number {\n  return 1;\n}\n')).toBe(true);
    expect(emitsCode("import './setup.ts';\n")).toBe(true);
  });
});
