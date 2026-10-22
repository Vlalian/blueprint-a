// Which tests the fast merge gate runs (ticket 56). the owner' rule (2026-10-05): run the tests the
// change can affect, which is the changed code and everything that depends on it. So the merge's
// changed files are walked up the module graph (scripts/affected-deps.ts) and each test file the
// walk reaches is selected, unit and integration alike. Run-time edges are read from the test
// files (a CLI they spawn by path, a fixture or config they read) and from Claude Code settings
// files (the hooks they load).
// It fails closed: every test runs, and the summary says why, when the graph cannot be built, when
// a changed file is not in it, when a change touches shared ground (config/runner.json's wholeSuite:
// by default the package files, tsconfig, the vitest configs, test/helpers, config/), or when the
// selection is too long to name on one
// command line. A changed source file no selected test reaches is a finding; process shells are
// left out of that, having no in-process test by design.
// vitest's `related` mode was not used: it answers one run at a time and cannot see the run-time
// edges, so dependency-cruiser's graph (config/dependency-cruiser.cjs) is the one recorded.
// Pure: the graph's texts in, a selection out.

import type { Observation, ObservationBase } from './observations.ts';
import { affectedBy, cruiseGraph, graphFiles, runtimeDeps, textDeps, treeOf, withDeps, type Graph } from './affected-deps.ts';
import { DEFAULTS, matchesAny } from './runner-config.ts';

export const GRAPH_SOURCE = 'dependency-cruiser (config/dependency-cruiser.cjs, imports that run) plus the paths tests name';

/** Files no code reads, unless a test names one (then it is in the graph). */
const UNREAD = /^docs\/|\.md$|^\.gitignore$/;

const TEST = /\.test\.ts$/;
const SETTINGS = /(^|\/)\.claude\/settings[^/]*\.json$/;

/** More than this many characters of test paths may not fit a Windows command line (32 767). */
export const MAX_NAMED_CHARS = 20_000;

export type Selection = { all: true; reason: string } | { all: false; unit: string[]; integration: string[]; untested: string[] };

/** dependency-cruiser over the configured code folders, as `node <entry> <args>` run in the repo root. */
export const cruiseArgs = (graphDirs: string[]) => ['--config', 'config/dependency-cruiser.cjs', '--output-type', 'json', ...graphDirs];
export const CRUISER = ['node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs'];

/** git's listing of every repo file, committed or not. */
export const LS_FILES = ['ls-files', '--cached', '--others', '--exclude-standard'];

/** The run-time edges of a test file or a settings file; none for any other. */
function deps(path: string, text: string, tree: ReturnType<typeof treeOf>): string[] {
  if (TEST.test(path)) return runtimeDeps(path, text, tree);
  return SETTINGS.test(path) ? textDeps(path, text, tree) : [];
}

/** dependency-cruiser's imports plus the run-time edges; or why there is no graph. */
export function moduleGraph(cruised: string | undefined, files: string[], read: (path: string) => string | undefined): Graph | string {
  const graph = cruiseGraph(cruised);
  if (typeof graph === 'string') return graph;
  const tree = treeOf(files);
  const texts = files.flatMap((f) => {
    const text = read(f);
    return text === undefined ? [] : [[f, deps(f, text, tree)] as const];
  });
  return withDeps(graph, new Map(texts));
}

const all = (reason: string): Selection => ({ all: true, reason });

/** What the selection takes from config/runner.json: the shared ground, and how an integration test is named. */
export type SelectRules = { wholeSuite: string[]; integrationSuffix: string };

const RULES: SelectRules = { wholeSuite: DEFAULTS.wholeSuite, integrationSuffix: DEFAULTS.integrationTests.suffix };

/** Why every test runs, when one must. */
function failClosed(changed: string[], graph: Graph | string, wholeSuite: string[]): string | undefined {
  if (typeof graph === 'string') return `the module graph could not be built: ${graph}`;
  const shared = changed.find((p) => matchesAny(p, wholeSuite));
  if (shared !== undefined) return `${shared} is shared ground`;
  const known = graphFiles(graph);
  const unknown = changed.find((p) => !known.has(p) && !UNREAD.test(p));
  return unknown === undefined ? undefined : `${unknown} is not in the module graph`;
}

const testsOf = (files: Set<string>) => [...files].filter((f) => TEST.test(f)).sort();

/**
 * The tests the change can reach, split into unit and integration, and the changed source files
 * (`graded`, less the `exempt` shells) that no test reaches; or every test, and why.
 */
export function selectTests(changed: string[], graph: Graph | string, graded: string[], exempt: string[], rules = RULES): Selection {
  const reason = failClosed(changed, graph, rules.wholeSuite);
  if (reason !== undefined) return all(reason);
  const g = graph as Graph;
  const tests = testsOf(affectedBy(changed, g));
  if (tests.join(' ').length > MAX_NAMED_CHARS) return all(`${tests.length} test files selected, too many to name on one command line`);
  const untested = graded.filter((f) => !exempt.includes(f) && testsOf(affectedBy([f], g)).length === 0);
  const isIntegration = (f: string) => f.endsWith(rules.integrationSuffix);
  return { all: false, unit: tests.filter((t) => !isIntegration(t)), integration: tests.filter(isIntegration), untested };
}

/** The summary's lines: what ran and why, and each changed file no test reaches. */
export function selectionLines(s: Selection): string[] {
  if (s.all) return [`tests: all of them (${s.reason})`];
  const counts = `tests: ${s.unit.length} unit and ${s.integration.length} integration test file(s) the change can reach, by ${GRAPH_SOURCE}`;
  return [counts, ...s.untested.map((f) => `  FINDING  ${f} changed, and no test reaches it`)];
}

/** 1 when a changed file has no test that reaches it, else 0. */
export const selectionExit = (s: Selection) => (!s.all && s.untested.length > 0 ? 1 : 0);

/** The selection as an observation, for the full run to find the tests no merge selected. */
export function selectionRecord(base: ObservationBase, sha: string, changed: string[], s: Selection): Observation {
  const tests = s.all ? [] : [...s.unit, ...s.integration];
  return { ...base, kind: 'selection', sha, changed, all: s.all, reason: s.all ? s.reason : '', tests };
}
