// The module graph the fast merge gate selects tests from (ticket 56). Its import edges are
// dependency-cruiser's (run with config/dependency-cruiser.cjs, type-only imports included); the
// edges no import shows are added here: a file that names another repo file in a string, such as a
// test that spawns a CLI by path (`join(ROOT, 'scripts', 'x.ts')`) or reads a fixture or config
// folder at run time, depends on that file (a folder: on every file in it), and a Claude Code
// settings file depends on the hook scripts it names. A change then affects every module that
// depends on it, directly or through others.
// Pure: texts in, edges out.

import { posix } from 'node:path';
import ts from 'typescript';

/** Each module and the repo files it depends on. */
export type Graph = Map<string, string[]>;

/** The repo's files, and each folder (two levels deep or more) with every file under it. */
export type Tree = { files: Set<string>; dirs: Map<string, string[]> };

export function treeOf(files: string[]): Tree {
  const dirs = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.split('/');
    for (let n = 2; n < parts.length; n++) {
      const dir = parts.slice(0, n).join('/');
      const under = dirs.get(dir);
      if (under === undefined) dirs.set(dir, [file]);
      else under.push(file);
    }
  }
  return { files: new Set(files), dirs };
}

type Dependency = { resolved?: unknown; coreModule?: unknown; couldNotResolve?: unknown; dependencyTypes?: unknown };
type Cruised = { source?: unknown; dependencies?: Dependency[] };

const outside = (path: string) => path.includes('node_modules');

/**
 * An import that runs: not Node's own module, not unresolved, and not type-only. The typecheck
 * stage checks types across the whole repo on every run; a type changes no test's outcome.
 */
const runs = (d: Dependency) => d.coreModule !== true && d.couldNotResolve !== true && !String(d.dependencyTypes).includes('type-only');

/** The imports of each module in dependency-cruiser's JSON output; or why there are none. */
export function cruiseGraph(json: string | undefined): Graph | string {
  let modules: unknown;
  try {
    modules = JSON.parse(json as string).modules;
  } catch {
    return 'dependency-cruiser gave no JSON';
  }
  if (!Array.isArray(modules)) return 'dependency-cruiser listed no modules';
  const graph: Graph = new Map();
  for (const m of modules as Cruised[]) {
    const source = String(m.source);
    if (outside(source)) continue;
    const deps = (m.dependencies ?? []).filter(runs).map((d) => String(d.resolved));
    graph.set(source, deps.filter((d) => !outside(d)));
  }
  return graph;
}

/** The file, or every file in the folder, that `path` names in the tree; none for the root or outside it. */
function filesAt(path: string, tree: Tree): string[] {
  if (tree.files.has(path)) return [path];
  return tree.dirs.get(path) ?? [];
}

/** A string (or strings joined as path segments) read from the repo root and from the file's own folder. */
function named(segments: string[], from: string, tree: Tree): string[] {
  const text = segments.join('/').replaceAll('\\', '/');
  // '', '.' and '..' name a folder by where the file is, not a file it reads.
  if (!/[^./]/.test(text)) return [];
  return [posix.normalize(text), posix.join(posix.dirname(from), text)].flatMap((p) => filesAt(p, tree));
}

/** Each string literal, and each run of string literals among a call's arguments (`join(ROOT, 'a', 'b.ts')`). */
function literalRuns(file: ts.SourceFile): string[][] {
  const runs: string[][] = [];
  const visit = (node: ts.Node) => {
    // A literal has nothing inside it to visit.
    if (ts.isStringLiteralLike(node)) return void runs.push([node.text]);
    if (ts.isCallExpression(node)) {
      let run: string[] = [];
      for (const arg of node.arguments) {
        if (ts.isStringLiteralLike(arg)) run.push(arg.text);
        else run = (runs.push(run), []);
      }
      runs.push(run);
    }
    node.forEachChild(visit);
  };
  visit(file);
  return runs;
}

const others = (path: string, deps: string[]) => [...new Set(deps)].filter((d) => d !== path).sort();

/** The repo files a TypeScript file names in its strings: what it spawns, reads or loads at run time. */
export function runtimeDeps(path: string, source: string, tree: Tree): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest);
  return others(path, literalRuns(file).flatMap((run) => named(run, path, tree)));
}

const PATHS = /[\w.@-]+(?:\/[\w.@-]+)+/g;

/** A path and each path it ends with: `$DIR/adapters/x.ts` names adapters/x.ts. */
const tails = (path: string) => path.split('/').map((_, i, parts) => parts.slice(i).join('/'));

/** The repo files a settings file names, such as the hook scripts Claude Code runs. */
export const textDeps = (path: string, text: string, tree: Tree) => others(path, [...text.matchAll(PATHS)].flatMap((m) => tails(m[0])).filter((p) => tree.files.has(p)));

/** The import graph with each file's run-time dependencies added. */
export function withDeps(graph: Graph, deps: Map<string, string[]>): Graph {
  const merged: Graph = new Map(graph);
  for (const [file, more] of deps) merged.set(file, [...new Set([...(merged.get(file) ?? []), ...more])]);
  return merged;
}

/** Every file the graph names, as a module or as a dependency. */
export function graphFiles(graph: Graph): Set<string> {
  return new Set([...graph.keys(), ...[...graph.values()].flat()]);
}

/** The changed files and every module that depends on one of them, directly or through others. */
export function affectedBy(changed: string[], graph: Graph): Set<string> {
  const up = dependentsOf(graph);
  const seen = new Set(changed);
  const queue = [...changed];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) queue.push(...unseen(up.get(next), seen));
  return seen;
}

/** Each file and the modules that depend on it directly. */
function dependentsOf(graph: Graph): Map<string, string[]> {
  const dependents = new Map<string, string[]>();
  for (const [file, deps] of graph) for (const d of deps) dependents.set(d, [...(dependents.get(d) ?? []), file]);
  return dependents;
}

/** The files not seen yet, now marked seen. */
function unseen(files: string[] | undefined, seen: Set<string>): string[] {
  const fresh = (files ?? []).filter((f) => !seen.has(f));
  for (const f of fresh) seen.add(f);
  return fresh;
}

/**
 * Whether a TypeScript source emits any JavaScript. A file of types only emits nothing a test could
 * run, so the gate's "changed, and no test reaches it" rule leaves it out (merge of 56: a records
 * file that only declares types is imported type-only, which the graph rightly leaves out).
 */
export function emitsCode(text: string): boolean {
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
  return js.replace(/export\s*\{\s*\};?/g, '').trim() !== '';
}
