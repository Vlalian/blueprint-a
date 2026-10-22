// The canary (ticket 15b): a weekly rerun of every gate's prove-it-bites test (test/helpers/
// prove-it-bites.ts): the gate passes clean input (0), fails an injected fault (1) and passes again
// once it is reverted (0). A gate that no longer bites turns the canary red and is a Needs you item
// on the briefing. Each bites test runs in its own vitest process; proveItBites appends one JSON
// line per check to the file named by WORKFLOW_CANARY_REPORT, naming its gate when a test file
// proves more than one. A test that reports no line (one that proves its gate another way) is
// judged by its exit code. Each gate's state goes to the observation log as a canary record
// (io.ts). The folders it searches are config/canary.json's, by default gates and adapters.

import { join, posix } from 'node:path';
import type { GateResult } from '../lib/contract.ts';
import { appendCanaryRecords, CANARY_LOG, type CanaryRecord, type CanaryState } from './io.ts';

export interface BitesTest {
  gate: string;
  /** Repo-relative, '/'-separated. */
  file: string;
  /** Run with vitest.integration.config.ts. */
  integration: boolean;
}

export interface TestRun {
  /** vitest's exit code; null when it was killed or timed out. */
  status: number | null;
  /** The report file's text, or undefined when the test wrote none. */
  report: string | undefined;
}

export interface CanaryGate {
  gate: string;
  file: string;
  state: CanaryState;
  detail: string;
}

export interface CanaryIo {
  /** Every file under the repo, repo-relative and '/'-separated. */
  files(): string[];
  runTest(file: string, integration: boolean): TestRun;
  now(): string;
  /** Appends to the file, creating it and its folder. */
  append(path: string, text: string): void;
}

interface Check {
  gate?: string;
  clean: number;
  injected: number;
  reverted: number;
}

const BITES = /[./]bites(\.integration)?\.test\.ts$/;
const DAY = 86_400_000;

function gateOf(file: string): string {
  const parts = file.split('/');
  return parts[0] === 'gates' ? parts[1] : (parts.at(-1) as string).replace(BITES, '');
}

/** Every prove-it-bites test (a *bites.test.ts or *bites.integration.test.ts), sorted by path. */
export function bitesTests(files: string[]): BitesTest[] {
  return files
    .filter((f) => BITES.test(f))
    .sort()
    .map((file) => ({ gate: gateOf(file), file, integration: file.endsWith('.integration.test.ts') }));
}

function checkOf(text: string): Check[] {
  try {
    const c = Object(JSON.parse(text)) as Partial<Check>;
    return [c.clean, c.injected, c.reverted].every((n) => typeof n === 'number') ? [c as Check] : [];
  } catch {
    return [];
  }
}

const checksIn = (report: string | undefined) => report?.split('\n').flatMap(checkOf) ?? [];

const codes = (c: Check) => `clean ${c.clean}, injected ${c.injected}, reverted ${c.reverted}`;

/** The state of one gate from its checks and the test's exit code (0 or 1). */
function stateOf(checks: Check[], status: number): Omit<CanaryGate, 'gate' | 'file'> {
  const toothless = checks.find((c) => c.injected !== 1);
  if (toothless) return { state: 'red', detail: `the injected fault no longer fails: ${codes(toothless)}` };
  const noisy = checks.find((c) => c.clean !== 0 || c.reverted !== 0);
  if (noisy) return { state: 'red', detail: `clean input fails: ${codes(noisy)}` };
  if (status !== 0) return { state: 'red', detail: `the bites test failed (exit ${status})` };
  return { state: 'green', detail: checks.length === 0 ? 'the bites test passed' : codes(checks[0]) };
}

/** One row per gate the test reported checks for (in report order), or one for the file's gate. */
export function judgeFile(test: BitesTest, run: TestRun): CanaryGate[] {
  if (run.status !== 0 && run.status !== 1) return [{ gate: test.gate, file: test.file, state: 'could-not-run', detail: `the bites test could not run (exit ${run.status ?? 'none'})` }];
  const status = run.status;
  const checks = checksIn(run.report);
  const gateOfCheck = (c: Check) => c.gate ?? test.gate;
  const gates = checks.length === 0 ? [test.gate] : [...new Set(checks.map(gateOfCheck))];
  return gates.map((gate) => ({ gate, file: test.file, ...stateOf(checks.filter((c) => gateOfCheck(c) === gate), status) }));
}

function verdict(gates: CanaryGate[]): Pick<GateResult, 'pass' | 'error'> {
  if (gates.length === 0) return { pass: false, error: 'no prove-it-bites test found' };
  if (gates.some((g) => g.state === 'red')) return { pass: false };
  const unchecked = gates.filter((g) => g.state === 'could-not-run').map((g) => g.gate);
  return unchecked.length === 0 ? { pass: true } : { pass: false, error: `the canary could not check ${unchecked.join(', ')}` };
}

/** Reruns every bites test; logs each gate's state when stateDir is given. */
export function runCanary(stateDir: string | undefined, io: CanaryIo): GateResult {
  const gates = bitesTests(io.files()).flatMap((t) => judgeFile(t, io.runTest(t.file, t.integration)));
  if (stateDir !== undefined) {
    const at = io.now();
    const base = { at, run: `canary-${at}`, project: '', ticket: '', role: 'canary' };
    const records = gates.map((g): CanaryRecord => ({ ...base, kind: 'canary', gate: g.gate, state: g.state, detail: g.detail }));
    appendCanaryRecords(posix.join(stateDir, CANARY_LOG), records, io);
  }
  return { gate: 'canary', ...verdict(gates), gates };
}

/** A log's records: the canary's among any other kind. */
type LogRecord = { kind: string };
const canaries = (records: LogRecord[]) => records.filter((r): r is CanaryRecord => r.kind === 'canary');

/** Whether the canary should run: never run yet, or the last run is everyDays or more ago. */
export function canaryDue(records: LogRecord[], now: string, everyDays: number): boolean {
  const last = Math.max(...canaries(records).map((r) => Date.parse(r.at)));
  return Date.parse(now) - last >= everyDays * DAY;
}

/** The latest canary state of each gate, sorted by gate. */
export function canaryStates(records: LogRecord[]): { gate: string; state: CanaryState; detail: string; at: string }[] {
  const latest = new Map(canaries(records).map((r) => [r.gate, { gate: r.gate, state: r.state, detail: r.detail, at: r.at }]));
  return [...latest.values()].sort((a, b) => a.gate.localeCompare(b.gate));
}

const PARENT_TEST_ENV = /^(VITEST.*|NODE_ENV|TEST)$/;

/** The environment for a nested vitest: this process's own test settings dropped, the report path added. */
export function childEnv(env: Record<string, string | undefined>, report: string): Record<string, string | undefined> {
  return { ...Object.fromEntries(Object.entries(env).filter(([k]) => !PARENT_TEST_ENV.test(k))), WORKFLOW_CANARY_REPORT: report };
}

/** Where the folders to search are named, relative to the root. */
export const CANARY_CONFIG = 'config/canary.json';

/** The folders a prove-it-bites test may live in when config/canary.json is not there. */
export const DEFAULT_DIRS = ['gates', 'adapters'];

/** config/canary.json's `dirs`, or DEFAULT_DIRS without the file; a file without a list of names throws. */
export function sourceDirs(config: string | undefined): string[] {
  if (config === undefined) return DEFAULT_DIRS;
  const dirs: unknown = (Object(JSON.parse(config)) as { dirs?: unknown }).dirs;
  if (Array.isArray(dirs) && dirs.every((d) => typeof d === 'string')) return dirs;
  throw new Error(`${CANARY_CONFIG}: "dirs" must be a list of folder names`);
}

/** readdirSync's recursive entries under one source folder, as repo-relative '/'-separated paths. */
export const sourceFiles = (dir: string, entries: string[]) => entries.map((e) => `${dir}/${e.split('\\').join('/')}`);

/** vitest's arguments for one bites test, with the root's unit or integration config. */
export const vitestArgs = (root: string, file: string, integration: boolean) => ['run', '--config', join(root, integration ? 'vitest.integration.config.ts' : 'vitest.config.ts'), file];

const NOTES: Record<string, string> = { 0: 'every gate still bites.', 1: 'a gate no longer bites; see Needs you.' };

/** The run note on a canary run, from the canary's exit code. */
export const canaryNote = (status: number | null) => `Canary: ${NOTES[String(status)] ?? 'it could not check every gate; see Needs you.'}`;
