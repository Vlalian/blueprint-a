import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { BASE_MARK, baseModule, baseResolve, exceptionRule, hooksFingerprint, logicalRepoPath, policyGuarded, repoPath, tamperCommand, tamperConfig, tamperProblems } from './core.ts';

describe('hooksFingerprint', () => {
  const a = { name: 'pre-commit', text: 'x' };
  const b = { name: 'post-checkout', text: 'y' };

  it('is the same whatever order the files come in, and changes with any hook, its text or core.hooksPath', () => {
    const base = hooksFingerprint([a, b], '', []);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(hooksFingerprint([b, a], '', [])).toBe(base);
    expect(hooksFingerprint([a], '', [])).not.toBe(base);
    expect(hooksFingerprint([a, { ...b, text: 'z' }], '', [])).not.toBe(base);
    expect(hooksFingerprint([a, { ...b, name: 'post-merge' }], '', [])).not.toBe(base);
    expect(hooksFingerprint([a, b], '/dev/null', [])).not.toBe(base);
  });

  it("leaves out git's samples and the hooks it is told to ignore", () => {
    const base = hooksFingerprint([b], '', []);
    expect(hooksFingerprint([b, { name: 'pre-push.sample', text: 's' }], '', [])).toBe(base);
    expect(hooksFingerprint([a, b], '', ['pre-commit'])).toBe(base);
    expect(hooksFingerprint([{ name: 'pre-push.samplex', text: 's' }, b], '', [])).not.toBe(base);
  });

  it('ignores a hook by its name in a configured folder too, but not a name that only ends the same', () => {
    const base = hooksFingerprint([b], '', []);
    expect(hooksFingerprint([{ name: '.githooks/pre-commit', text: 'x' }, b], '', ['pre-commit'])).toBe(base);
    expect(hooksFingerprint([{ name: '.githooks/my-pre-commit', text: 'x' }, b], '', ['pre-commit'])).not.toBe(base);
  });

  it('keeps a name and its text apart, so moving text between names changes it', () => {
    expect(hooksFingerprint([{ name: 'xy', text: 'z' }], '', [])).not.toBe(hooksFingerprint([{ name: 'x', text: 'yz' }], '', []));
  });
});

describe('tamperProblems', () => {
  const GLOBS = ['docs/adr/**', 'CONTEXT.md', 'projects/*/directives.md'];
  const none = () => undefined;

  it('names every protected path that differs from the base, with the owner; other paths are not its business', () => {
    expect(tamperProblems(['src/a.ts', 'CONTEXT.md', 'docs/adr/0001.md', 'docs/x.md'], GLOBS, 'the lead', none)).toEqual([
      'CONTEXT.md is tier 4 and differs from the base; only the lead changes it, and agents never do',
      'docs/adr/0001.md is tier 4 and differs from the base; only the lead changes it, and agents never do',
    ]);
    expect(tamperProblems(['context.md'], GLOBS, 'x', none)).toHaveLength(1);
    expect(tamperProblems(['src/a.ts'], GLOBS, 'x', none)).toEqual([]);
  });

  it('asks the exception about each protected path only: it lets one through, refuses one with its reason, or leaves it to the gate', () => {
    const seen: string[] = [];
    const exception = (path: string) => {
      seen.push(path);
      if (path === 'projects/ok/directives.md') return {};
      return path === 'projects/bad/directives.md' ? { problem: 'no approval' } : undefined;
    };
    expect(tamperProblems(['src/a.ts', 'projects/ok/directives.md', 'projects/bad/directives.md', 'CONTEXT.md'], GLOBS, 'x', exception)).toEqual([
      'projects/bad/directives.md: no approval',
      'CONTEXT.md is tier 4 and differs from the base; only x changes it, and agents never do',
    ]);
    expect(seen).toEqual(['projects/ok/directives.md', 'projects/bad/directives.md', 'CONTEXT.md']);
  });
});

describe('tamperConfig', () => {
  const FILE = join('etc', 'tamper.json');
  const read = (files: Record<string, string>) => (path: string) => files[path];

  it('reads the protected globs, the owner, the hook targets and the exception module', () => {
    const text = JSON.stringify({ protectedPaths: ['a/**'], owner: 'the lead', hooks: ['.git/hooks', 'h.json'], exceptions: 'x.ts' });
    expect(tamperConfig(FILE, read({ [FILE]: text }))).toEqual({ protectedPaths: ['a/**'], owner: 'the lead', hooks: ['.git/hooks', 'h.json'], exceptions: 'x.ts', tiers: undefined });
  });

  it("calls the owner 'the owner' and leaves the hook targets and the exception module out when it names none", () => {
    expect(tamperConfig(FILE, read({ [FILE]: '{ "protectedPaths": [] }' }))).toEqual({ protectedPaths: [], owner: 'the owner', hooks: undefined, exceptions: undefined, tiers: undefined });
  });

  it("takes the protected globs from a tiers file's tier 4, found from the config's folder, and adds its own", () => {
    const tiers = { [join('etc', 'tiers.json')]: '{ "tier4": { "protectedPaths": ["CONTEXT.md"] } }' };
    expect(tamperConfig(FILE, read({ ...tiers, [FILE]: '{ "tiers": "tiers.json", "protectedPaths": ["config/canary.json"] }' }))).toMatchObject({ protectedPaths: ['CONTEXT.md', 'config/canary.json'], tiers: 'tiers.json' });
    expect(tamperConfig(FILE, read({ ...tiers, [FILE]: '{ "tiers": "tiers.json" }' })).protectedPaths).toEqual(['CONTEXT.md']);
    expect(() => tamperConfig(FILE, read({ [FILE]: '{ "tiers": "tiers.json", "protectedPaths": ["a"] }' }))).toThrow(/name the protected globs/);
  });

  it('throws, so the gate could not run, without the file or without protected globs', () => {
    expect(() => tamperConfig(FILE, read({}))).toThrow(`no tamper config at ${FILE}: it names the protected paths`);
    const unnamed = `${FILE}: name the protected globs in "protectedPaths", or a tiers file with tier4.protectedPaths in "tiers"`;
    expect(() => tamperConfig(FILE, read({ [FILE]: '{}' }))).toThrow(unnamed);
    expect(() => tamperConfig(FILE, read({ [FILE]: '{ "tiers": "tiers.json" }' }))).toThrow(unnamed);
    expect(() => tamperConfig(FILE, read({ [FILE]: '{ "tiers": "t.json" }', [join('etc', 't.json')]: '{ "tier4": {} }' }))).toThrow(unnamed);
    expect(() => tamperConfig(FILE, read({ [FILE]: '{ "tiers": "t.json" }', [join('etc', 't.json')]: '{}' }))).toThrow(unnamed);
    expect(() => tamperConfig(FILE, read({ [FILE]: '{' }))).toThrow();
  });

  it.each([
    ['protectedPaths', '"a"'],
    ['protectedPaths', '[1]'],
    ['owner', '1'],
    ['hooks', '"h"'],
    ['hooks', '[null]'],
    ['exceptions', '[]'],
    ['tiers', '1'],
  ])('throws on a %s of the wrong type (%s)', (key, value) => {
    const text = `{ "protectedPaths": ["a"], "${key}": ${value} }`;
    expect(() => tamperConfig(FILE, read({ [FILE]: text }))).toThrow(`${FILE}: "${key}" has the wrong type`);
  });
});

describe('repoPath', () => {
  const TOP = join('/', 'repo');

  it("is a file's path in the repo, '/'-separated, or undefined outside it", () => {
    expect(repoPath(TOP, join(TOP, 'config', 'tamper.json'))).toBe('config/tamper.json');
    expect(repoPath(TOP, join(TOP, '..dot', 'x'))).toBe('..dot/x');
    expect(repoPath(TOP, join('/', 'elsewhere', 'tamper.json'))).toBeUndefined();
    expect(repoPath(TOP, TOP)).toBeUndefined();
  });
});

describe('logicalRepoPath', () => {
  const TOP = join('/', 'real', 'repo');
  const LINK = join('/', 'link');
  // /link is a symlink to /real; inside the repo, config is a symlink out of it.
  const real = (path: string) => (path === LINK ? join('/', 'real') : path === join(LINK, 'repo') ? TOP : path === join(TOP, 'config') ? join('/', 'elsewhere') : path);

  it("is a file's repo path by the path as written, whatever a symlink inside the repo points at", () => {
    expect(logicalRepoPath(TOP, join(TOP, 'config', 'tamper.json'), real)).toBe('config/tamper.json');
    expect(logicalRepoPath(TOP, join(TOP, 'a.ts'), real)).toBe('a.ts');
  });

  it('finds the repo through a symlink above it', () => {
    expect(logicalRepoPath(TOP, join(LINK, 'repo', 'config', 'tamper.json'), real)).toBe('config/tamper.json');
  });

  it('is undefined outside the repo and for the repo itself', () => {
    expect(logicalRepoPath(TOP, join('/', 'elsewhere', 'tamper.json'), real)).toBeUndefined();
    expect(logicalRepoPath(TOP, TOP, real)).toBeUndefined();
  });
});

describe('policyGuarded', () => {
  const config = { protectedPaths: ['CONTEXT.md'], owner: 'o' };

  it('adds the config, its tiers file and its exception module to the protected globs when the config is in the repo', () => {
    expect(policyGuarded({ ...config, tiers: 'tiers.json', exceptions: '../scripts/x.ts' }, 'config/tamper.json')).toEqual(['CONTEXT.md', 'config/tamper.json', 'config/tiers.json', 'scripts/x.ts']);
    expect(policyGuarded(config, 'tamper.json')).toEqual(['CONTEXT.md', 'tamper.json']);
  });

  it('leaves the globs as they are for a config outside the repo', () => {
    expect(policyGuarded({ ...config, exceptions: 'x.ts' }, undefined)).toEqual(['CONTEXT.md']);
  });
});

describe('loading the exception module from the base', () => {
  const TOP = join('/', 'repo');
  const topUrl = pathToFileURL(join(TOP, '/')).href;
  const url = (...p: string[]) => pathToFileURL(join(TOP, ...p)).href;
  const mark = (u: string) => `${u}?${BASE_MARK}`;

  it('keeps a marked entry and resolves a plain relative import of a marked module by its path as written, never through a symlink', () => {
    expect(baseResolve(mark(url('config', 'allow.ts')), undefined, topUrl)).toBe(mark(url('config', 'allow.ts')));
    expect(baseResolve('./rule.ts', mark(url('config', 'allow.ts')), topUrl)).toBe(mark(url('config', 'rule.ts')));
    expect(baseResolve('../lib/rule.ts', mark(url('config', 'allow.ts')), topUrl)).toBe(mark(url('lib', 'rule.ts')));
  });

  it('leaves to Node an unmarked entry, an import of an unmarked module and a node: builtin', () => {
    expect(baseResolve(url('config', 'allow.ts'), undefined, topUrl)).toBeUndefined();
    expect(baseResolve(mark(pathToFileURL(join('/', 'other', 'x.ts')).href), undefined, topUrl)).toBeUndefined();
    expect(baseResolve('./rule.ts', url('allow.ts'), topUrl)).toBeUndefined();
    expect(baseResolve('./rule.ts', undefined, topUrl)).toBeUndefined();
    expect(baseResolve('node:path', mark(url('allow.ts')), topUrl)).toBeUndefined();
  });

  it('refuses, naming it, every other import of a marked module: a query, a fragment, an absolute path, a URL, a bare name, a way out of the repo (review round 3)', () => {
    const refused = (specifier: string) => `the exception module imports ${JSON.stringify(specifier)}: from the trusted base it loads only plain relative imports ('./x.mjs', '../y.mjs') and node: builtins`;
    const parent = mark(url('config', 'allow.ts'));
    const others = ['./rule.ts?variant=1', './rule.ts#x', './rule.ts?tamper-base', join(TOP, 'rule.ts'), url('rule.ts'), mark(url('rule.ts')), 'vitest', 'fs', 'lib/rule.ts', 'lib/./rule.ts', '../../other/x.ts', 'data:text/javascript,export const rule = () => ({})'];
    for (const specifier of others) expect(() => baseResolve(specifier, parent, topUrl), specifier).toThrow(refused(specifier));
  });

  it("serves a marked module's text at the base, TypeScript as TypeScript, by its repo path", () => {
    const seen: string[] = [];
    const show = (path: string) => (seen.push(path), `// ${path}`);
    expect(baseModule(mark(url('scripts', 'x.ts')), TOP, show)).toEqual({ format: 'module-typescript', source: '// scripts/x.ts' });
    expect(baseModule(mark(url('x.mjs')), TOP, show)).toEqual({ format: 'module', source: '// x.mjs' });
    expect(seen).toEqual(['scripts/x.ts', 'x.mjs']);
  });

  it.each([
    ["const r = createRequire(import.meta.url); r('./rule.cjs');", 'createRequire'],
    ["const rule = require('./rule.cjs');", 'require()'],
    ["const m = await import('./rule.mjs');", 'a dynamic import()'],
    ["process.binding('fs');", 'process.binding'],
    ["eval('1');", 'eval()'],
    ["new Function('return 1');", 'new Function()'],
  ])('refuses a base module that can reach the work tree outside its static imports: %s (review round 4)', (source, what) => {
    expect(() => baseModule(mark(url('rule.mjs')), TOP, () => source)).toThrow(`rule.mjs uses ${what}: the exception module and its imports may load code only through plain static relative imports`);
  });

  it('serves a base module that only names an escape in a comment or a string (review round 5)', () => {
    const source = "// Do not use createRequire here.\n/* nor eval() */\nexport const message = 'require() is disabled';\nexport const tamperException = () => undefined;";
    expect(baseModule(mark(url('ok.mjs')), TOP, () => source)).toEqual({ format: 'module', source });
  });

  it('refuses node:fs where the import resolves, naming it (review round 5)', () => {
    const parent = mark(url('rule.mjs'));
    expect(() => baseResolve('node:fs', parent, pathToFileURL(TOP).href)).toThrow('"node:fs"');
    expect(() => baseResolve('node:fs/promises', parent, pathToFileURL(TOP).href)).toThrow('"node:fs/promises"');
    expect(baseResolve('node:path', parent, pathToFileURL(TOP).href)).toBeUndefined();
  });

  it.each([
    ["process.dlopen(m, 'x.node');", 'process.binding'],
    ["const r = require ('./x.cjs');", 'require()'],
  ])('refuses %s too (review round 5)', (source, what) => {
    expect(() => baseModule(mark(url('rule.mjs')), TOP, () => source)).toThrow(`rule.mjs uses ${what}:`);
  });

  it('serves method calls and names that only share a word with an escape (review round 5)', () => {
    const source = "obj.require('x'); x.eval(1); a.import(1); const e = process.env.X; other.binding(1); const m = new Map(); const f = Function.prototype; const binding = 1; f(process, binding);";
    expect(baseModule(mark(url('ok.mjs')), TOP, () => source)).toEqual({ format: 'module', source });
  });

  it('serves a base module whose words only look like an escape', () => {
    const source = "import { join } from 'node:path';\nexport const requirement = 'x'; // imports are static\nconst evaluate = 1;";
    expect(baseModule(mark(url('ok.mjs')), TOP, () => source)).toEqual({ format: 'module', source });
  });

  it('leaves an unmarked module to the disk', () => {
    expect(baseModule(url('x.mjs'), TOP, () => 'text')).toBeUndefined();
  });

  it('throws for a marked module the base does not hold or that lies outside the repo, so it never loads from the disk (review round 3)', () => {
    const show = (path: string) => (path === 'gone.mjs' ? undefined : 'text');
    expect(() => baseModule(mark(url('gone.mjs')), TOP, show)).toThrow('gone.mjs is not in the trusted base, so the exception module cannot load it');
    const other = mark(pathToFileURL(join('/', 'other', 'x.mjs')).href);
    expect(() => baseModule(other, TOP, show)).toThrow(`${other} is not in the trusted base, so the exception module cannot load it`);
  });
});

describe('exceptionRule', () => {
  it("is the module's tamperException, and throws when it exports none", () => {
    const rule = () => undefined;
    expect(exceptionRule({ tamperException: rule }, 'x.ts')).toBe(rule);
    expect(() => exceptionRule({}, 'x.ts')).toThrow('x.ts exports no tamperException');
    expect(() => exceptionRule({ tamperException: 'no' }, 'x.ts')).toThrow('x.ts exports no tamperException');
  });
});

describe('tamperCommand', () => {
  it('runs the gate from the Workflow repo with the base, the hooks fingerprint and the state folder, quoted', () => {
    expect(tamperCommand({ workflow: 'C:/w f', base: 'abc', hooks: 'f00', state: 'C:/w f/state' })).toBe('node "C:/w f/gates/tamper/cli.ts" --base abc --hooks f00 --state "C:/w f/state"');
  });
});
