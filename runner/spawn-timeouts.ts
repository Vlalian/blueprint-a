// The Windows load rule for this repo's tests (ticket 29), checked over every test file by
// spawn-timeouts.test.ts. Under a full-suite load on Windows, git and process spawns run several
// times slower than alone, so a test that spawns a process never relies on finishing within a few
// seconds: each test and hook it has gets an explicit timeout of at least 60 s, or the file sets
// one for all of them with vi.setConfig({ testTimeout, hookTimeout }). The integration suite's
// config sets both for every file it runs.
// A file spawns when it calls a child_process spawner itself, or imports a helper from
// test/helpers that does. Pure: source text in, findings out; parsed with the repo's TypeScript.

import { posix } from 'node:path';
import ts from 'typescript';

export const MIN_SPAWN_TIMEOUT_MS = 60_000;

const SPAWNERS = new Set<string | undefined>(['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync']);
const TESTS = new Set<string | undefined>(['it', 'test']);
const HOOKS = new Set<string | undefined>(['beforeAll', 'beforeEach', 'afterAll', 'afterEach']);
/** Modifiers that take arguments and return the test function: it.each(rows)(name, fn). */
const FACTORIES = new Set(['each', 'for', 'skipIf', 'runIf']);

const problem = (kind: string, key: string) =>
  `a test file that spawns a process gives this ${kind} a timeout of at least 60 s, or sets ${key} >= 60 s for the file (vi.setConfig)`;
type Kind = 'test' | 'hook';
const PROBLEMS: Record<Kind, string> = { test: problem('test', 'testTimeout'), hook: problem('hook', 'hookTimeout') };
const BELOW = 'a test file that spawns a process never sets a timeout below 60 s';

const parse = (path: string, source: string) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest);

function eachNode(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => eachNode(child, visit));
}

const isChildProcess = (s: ts.Statement): s is ts.ImportDeclaration =>
  ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && /^(node:)?child_process$/.test(s.moduleSpecifier.text);

/** The name a call is made by: `spawnSync(...)` and `cp.spawnSync(...)` are both `spawnSync`. */
function calledName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

/** Whether the file at `path` imports child_process and calls one of its spawners. */
export function spawns(path: string, source: string): boolean {
  const file = parse(path, source);
  if (!file.statements.some(isChildProcess)) return false;
  let found = false;
  eachNode(file, (node) => {
    if (ts.isCallExpression(node) && SPAWNERS.has(calledName(node))) found = true;
  });
  return found;
}

/** Whether `path` imports one of `helpers` (repo-relative paths). */
function importsHelper(path: string, file: ts.SourceFile, helpers: string[]): boolean {
  return file.statements.some(
    (s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && helpers.includes(posix.join(posix.dirname(path), s.moduleSpecifier.text)),
  );
}

/** The file's top-level numeric constants, by name. */
function constants(file: ts.SourceFile): Map<string, number> {
  const values = new Map<string, number>();
  for (const s of file.statements.filter(ts.isVariableStatement)) {
    for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer !== undefined && ts.isNumericLiteral(d.initializer)) values.set(d.name.text, Number(d.initializer.text));
    }
  }
  return values;
}

/** A number written as a literal or as one of the file's constants. */
function numberOf(node: ts.Node, consts: Map<string, number>): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  return ts.isIdentifier(node) ? consts.get(node.text) : undefined;
}

/** The value of `key` in an object literal argument. */
function property(node: ts.Node | undefined, key: string, consts: Map<string, number>): number | undefined {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) return undefined;
  const prop = node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key);
  return prop === undefined ? undefined : numberOf(prop.initializer, consts);
}

/** The name a callee is rooted at: `it` for it.only and for it.each(rows). */
function rootName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee) ? rootName(callee.expression) : undefined;
}

/** Whether the call registers a test or a hook, through modifiers such as it.only and it.each(rows)(...). */
function kindOf(call: ts.CallExpression): Kind | undefined {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee) && FACTORIES.has(callee.name.text)) return undefined;
  const name = rootName(callee);
  if (TESTS.has(name)) return 'test';
  return HOOKS.has(name) ? 'hook' : undefined;
}

/** The explicit timeout of a test or hook: a trailing number, or `timeout` in an options object. */
function explicitTimeout(call: ts.CallExpression, consts: Map<string, number>): number | undefined {
  const trailing = call.arguments.slice(-1).map((last) => numberOf(last, consts))[0];
  return trailing ?? call.arguments.map((a) => property(a, 'timeout', consts)).find((t) => t !== undefined);
}

/** The file-wide timeouts set by vi.setConfig({ testTimeout, hookTimeout }), and the call that sets them. */
function fileConfig(file: ts.SourceFile, consts: Map<string, number>): { call?: ts.CallExpression; test?: number; hook?: number } {
  const call = file.statements
    .filter(ts.isExpressionStatement)
    .map((s) => s.expression)
    .find((e): e is ts.CallExpression => ts.isCallExpression(e) && e.expression.getText(file) === 'vi.setConfig');
  const arg = call?.arguments[0];
  return { call, test: property(arg, 'testTimeout', consts), hook: property(arg, 'hookTimeout', consts) };
}

/** testTimeout and hookTimeout, in ms, as a vitest config sets them. */
export interface SuiteTimeouts {
  test?: number;
  hook?: number;
}

const below = (ms: number | undefined) => (ms ?? Infinity) < MIN_SPAWN_TIMEOUT_MS;
const enough = (ms: number | undefined) => (ms ?? 0) >= MIN_SPAWN_TIMEOUT_MS;

/** What is wrong with a test or hook's timeout, if anything; `covered` when the file or its config sets enough. */
function problemOf(timeout: number | undefined, covered: boolean, kind: Kind): string | undefined {
  if (below(timeout)) return `${BELOW} (${timeout} ms)`;
  return timeout === undefined && !covered ? PROBLEMS[kind] : undefined;
}

/**
 * Each test or hook of a spawning test file that can time out in under 60 s, as `path:line problem`.
 * `helpers` are the repo-relative paths of the test/helpers modules that spawn; `suite` is what the
 * file's vitest config sets for every file it runs, which the file's own vi.setConfig overrides.
 */
export function spawnTimeoutFindings(path: string, source: string, helpers: string[], suite: SuiteTimeouts = {}): string[] {
  const file = parse(path, source);
  if (!spawns(path, source) && !importsHelper(path, file, helpers)) return [];
  const consts = constants(file);
  const config = fileConfig(file, consts);
  const covered = { test: enough(config.test ?? suite.test), hook: enough(config.hook ?? suite.hook) };
  const findings: { pos: number; text: string }[] = [];
  const at = (node: ts.Node, text: string) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    findings.push({ pos: node.getStart(file), text: `${path}:${line} ${text}` });
  };
  const worst = [config.test, config.hook].find(below);
  if (worst !== undefined) at(config.call!, `${BELOW} (${worst} ms)`);
  eachNode(file, (node) => {
    const kind = ts.isCallExpression(node) ? kindOf(node) : undefined;
    const text = kind && problemOf(explicitTimeout(node as ts.CallExpression, consts), covered[kind], kind);
    if (text !== undefined) at(node, text);
  });
  return findings.sort((a, b) => a.pos - b.pos).map((f) => f.text);
}
