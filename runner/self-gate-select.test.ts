// Ticket 56's Pass-when cases for the selection, on a module graph dependency-cruiser recorded for a
// toy repo: deep.ts <- low.ts <- mid.ts <- top.ts <- scripts/cli.ts, each with its own test; leaf.ts
// imported by its test alone; other.ts with a type-only import of types.ts; and an integration
// test that spawns scripts/cli.ts by path.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Graph } from './affected-deps.ts';
import { DEFAULTS, matchesAny } from './runner-config.ts';
import { cruiseArgs, CRUISER, LS_FILES, MAX_NAMED_CHARS, moduleGraph, selectionExit, selectionLines, selectionRecord, selectTests, type Selection } from './self-gate-select.ts';

const RECORDED = readFileSync(join(import.meta.dirname, '..', 'test', 'fixtures', 'affected-tests', 'cruise.json'), 'utf8');
const SPAWNING = "spawnSync(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'cli.ts')]);";
const TEXTS: Record<string, string> = { 'scripts/cli.integration.test.ts': SPAWNING, '.claude/settings.json': '{"command": "node $DIR/gates/leaf.ts"}', 'gates/other.ts': "read('gates/leaf.ts')" };
const FILES = [
  ...['deep', 'low', 'mid', 'top', 'leaf', 'other', 'types'].flatMap((m) => [`gates/${m}.ts`, ...(m === 'types' ? [] : [`gates/${m}.test.ts`])]),
  'scripts/cli.ts',
  'scripts/cli.integration.test.ts',
  'test/helpers/help.ts',
  '.claude/settings.json',
];
// Built in each test, not at load: a fault in the graph then fails the tests rather than the file.
const recorded = () => moduleGraph(RECORDED, FILES, (p) => TEXTS[p]) as Graph;
const select = (changed: string[], graded: string[] = [], exempt: string[] = []) => selectTests(changed, recorded(), graded, exempt);

describe('moduleGraph — imports plus run-time edges', () => {
  it('adds what tests and settings files name, not what other sources name', () => {
    expect(recorded().get('scripts/cli.integration.test.ts')).toEqual(['scripts/cli.ts']);
    expect(recorded().get('.claude/settings.json')).toEqual(['gates/leaf.ts']);
    expect(recorded().get('gates/other.ts')).toEqual([]);
  });

  it('reads every settings file, at the root or below, and no other', () => {
    const texts: Record<string, string> = { 'x/.claude/settings.local.json': 'gates/leaf.ts', '.claude/settings.json.bak': 'gates/leaf.ts', 'gates/leaf.test.tsx': "'gates/leaf.ts'" };
    const g = moduleGraph(RECORDED, [...FILES, ...Object.keys(texts)], (p) => texts[p]) as Graph;
    expect(g.get('x/.claude/settings.local.json')).toEqual(['gates/leaf.ts']);
    expect(g.get('.claude/settings.json.bak')).toEqual([]);
    expect(g.get('gates/leaf.test.tsx')).toEqual([]);
  });

  it('runs dependency-cruiser over the code folders with the repo config, and lists every file git knows', () => {
    expect(CRUISER).toEqual(['node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs']);
    expect(cruiseArgs(['gates', 'test'])).toEqual(['--config', 'config/dependency-cruiser.cjs', '--output-type', 'json', 'gates', 'test']);
    expect(LS_FILES).toEqual(['ls-files', '--cached', '--others', '--exclude-standard']);
  });

  it('says why when dependency-cruiser gave nothing', () => {
    expect(moduleGraph('', FILES, () => undefined)).toBe('dependency-cruiser gave no JSON');
  });

  it('reads a listed file it cannot open as empty', () => {
    expect(moduleGraph(RECORDED, ['gates/x.test.ts'], () => undefined)).toEqual(moduleGraph(RECORDED, [], () => undefined));
  });
});

describe('selectTests — the tests a change can reach (ticket 56 Pass when)', () => {
  it('a change to a leaf module selects only the tests that reach it', () => {
    expect(select(['gates/leaf.ts'])).toEqual({ all: false, unit: ['gates/leaf.test.ts'], integration: [], untested: [] });
  });

  it('a change to a module three imports deep selects the tests of every module above it', () => {
    expect(select(['gates/deep.ts'])).toEqual({ all: false, unit: ['gates/deep.test.ts', 'gates/low.test.ts', 'gates/mid.test.ts', 'gates/top.test.ts'], integration: ['scripts/cli.integration.test.ts'], untested: [] });
  });

  it('a CLI spawned by path selects its spawning tests', () => {
    expect(select(['scripts/cli.ts'])).toEqual({ all: false, unit: [], integration: ['scripts/cli.integration.test.ts'], untested: [] });
  });

  it('lists the selected tests by path, whatever order the walk met them in', () => {
    const graph = new Map([['x.ts', []], ['y.ts', ['x.ts']], ['b.test.ts', ['x.ts']], ['a.test.ts', ['y.ts']]]);
    expect(selectTests(['x.ts'], graph, [], [])).toMatchObject({ unit: ['a.test.ts', 'b.test.ts'] });
  });

  it('selects test files only, not a file that merely looks like one', () => {
    const graph = new Map([...recorded(), ['gates/leaf.test.tsx', ['gates/leaf.ts']], ['gates/leaf.test.ts.snap', ['gates/leaf.ts']]]);
    expect(selectTests(['gates/leaf.ts'], graph, [], [])).toMatchObject({ unit: ['gates/leaf.test.ts'] });
  });

  it('a changed test selects itself; a type-only import selects nothing', () => {
    expect(select(['gates/top.test.ts'])).toMatchObject({ unit: ['gates/top.test.ts'] });
    expect(select(['gates/types.ts'])).toMatchObject({ all: false, unit: [], integration: [] });
  });

  it('a lockfile or test/helpers change selects everything', () => {
    expect(select(['gates/leaf.ts', 'package-lock.json'])).toEqual({ all: true, reason: 'package-lock.json is shared ground' });
    expect(select(['test/helpers/help.ts'])).toEqual({ all: true, reason: 'test/helpers/help.ts is shared ground' });
    for (const p of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts', 'vitest.integration.config.ts', 'config/tiers.json']) expect(matchesAny(p, DEFAULTS.wholeSuite)).toBe(true);
    for (const p of ['gates/package.json', 'scripts/config/x.ts', 'xpackage.json', 'tsconfig/x.ts', 'vitest.ts', 'mytest/helpers/a.ts']) expect(matchesAny(p, DEFAULTS.wholeSuite)).toBe(false);
  });

  it('takes its shared ground and its integration suffix from the runner config (ticket 83)', () => {
    const rules = { wholeSuite: ['yarn.lock'], integrationSuffix: '.integration.test.ts' };
    expect(selectTests(['gates/leaf.ts', 'yarn.lock'], recorded(), [], [], rules)).toEqual({ all: true, reason: 'yarn.lock is shared ground' });
    expect(selectTests(['gates/leaf.ts', 'package-lock.json'], new Map([...recorded(), ['package-lock.json', []]]), [], [], rules)).toMatchObject({ all: false });
    expect(selectTests(['scripts/cli.ts'], recorded(), [], [], { ...rules, integrationSuffix: '.cli.integration.test.ts' })).toMatchObject({ unit: ['scripts/cli.integration.test.ts'], integration: [] });
  });

  it('a missing graph runs everything and says why', () => {
    expect(selectTests(['gates/leaf.ts'], 'dependency-cruiser gave no JSON', [], [])).toEqual({ all: true, reason: 'the module graph could not be built: dependency-cruiser gave no JSON' });
  });

  it('a changed file not in the graph runs everything; docs and Markdown no code reads do not', () => {
    expect(select(['gates/new.ts'])).toEqual({ all: true, reason: 'gates/new.ts is not in the module graph' });
    expect(select(['adapters/git/pre-commit.template'])).toMatchObject({ all: true });
    expect(select(['docs/tickets/56-affected-tests.md', 'skills/x/SKILL.md', '.gitignore'])).toEqual({ all: false, unit: [], integration: [], untested: [] });
    expect(select(['xdocs/a.ts'])).toMatchObject({ all: true });
    expect(select(['a.mdx'])).toMatchObject({ all: true });
    expect(select(['a.gitignore'])).toMatchObject({ all: true });
    expect(select(['.gitignore.old'])).toMatchObject({ all: true });
  });

  it('a hook named in the settings selects the tests of the settings file too', () => {
    const graph = new Map([...recorded(), ['gates/settings.test.ts', ['.claude/settings.json']]]);
    expect(selectTests(['gates/leaf.ts'], graph, [], [])).toMatchObject({ unit: ['gates/leaf.test.ts', 'gates/settings.test.ts'] });
  });

  it('a changed file with no selected test is reported, unless it is exempt', () => {
    const graph = new Map([...recorded(), ['gates/lonely.ts', []], ['gates/shell.ts', []]]);
    const s = selectTests(['gates/lonely.ts', 'gates/shell.ts', 'gates/leaf.ts'], graph, ['gates/lonely.ts', 'gates/shell.ts', 'gates/leaf.ts'], ['gates/shell.ts']);
    expect(s).toMatchObject({ untested: ['gates/lonely.ts'] });
    expect(selectionExit(s)).toBe(1);
    expect(selectionLines(s)).toEqual([
      'tests: 1 unit and 0 integration test file(s) the change can reach, by dependency-cruiser (config/dependency-cruiser.cjs, imports that run) plus the paths tests name',
      '  FINDING  gates/lonely.ts changed, and no test reaches it',
    ]);
  });

  it('runs everything when the selection is too long to name on one command line', () => {
    const many = Array.from({ length: 800 }, (_, i) => [`gates/m${i}/long-folder-name/x.test.ts`, ['gates/deep.ts']] as [string, string[]]);
    const chars = many.map(([t]) => t).join(' ').length;
    expect(chars).toBeGreaterThan(MAX_NAMED_CHARS);
    expect(selectTests(['gates/deep.ts'], new Map([...recorded(), ...many]), [], [])).toEqual({ all: true, reason: '805 test files selected, too many to name on one command line' });
    const exact = new Map([...recorded(), ...many.slice(0, 1)]);
    const fit = (selectTests(['gates/deep.ts'], exact, [], []) as { unit: string[]; integration: string[] });
    const named = [...fit.unit, ...fit.integration].join(' ').length;
    const pad = 'p'.repeat(MAX_NAMED_CHARS - named - 1 - '.test.ts'.length);
    expect(selectTests(['gates/deep.ts'], new Map([...exact, [`${pad}.test.ts`, ['gates/deep.ts']]]), [], [])).toMatchObject({ all: false });
    expect(selectTests(['gates/deep.ts'], new Map([...exact, [`${pad}x.test.ts`, ['gates/deep.ts']]]), [], [])).toMatchObject({ all: true });
  });
});

describe('selectionLines, selectionExit and selectionRecord', () => {
  const all: Selection = { all: true, reason: 'package.json is shared ground' };
  const some: Selection = { all: false, unit: ['a.test.ts'], integration: ['b.integration.test.ts'], untested: [] };
  const base = { at: '2026-10-05T10:00:00.000Z', run: '', project: 'workflow', ticket: 'origin/ticket/7', role: '' };

  it('says what ran and why', () => {
    expect(selectionLines(all)).toEqual(['tests: all of them (package.json is shared ground)']);
    expect(selectionExit(all)).toBe(0);
    expect(selectionExit(some)).toBe(0);
  });

  it('records the selection for the full run', () => {
    expect(selectionRecord(base, 'abc', ['x.ts'], some)).toEqual({ ...base, kind: 'selection', sha: 'abc', changed: ['x.ts'], all: false, reason: '', tests: ['a.test.ts', 'b.integration.test.ts'] });
    expect(selectionRecord(base, 'abc', ['package.json'], all)).toEqual({ ...base, kind: 'selection', sha: 'abc', changed: ['package.json'], all: true, reason: 'package.json is shared ground', tests: [] });
  });
});
