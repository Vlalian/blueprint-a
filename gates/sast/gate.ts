// The sast gate (ticket 60) with its I/O passed in, so it is tested in-process with recorded Semgrep
// output; cli.ts only wires in Semgrep, git and the file system. It scans the source files a change
// touched (the change, not the repo: ticket 56's rule) with the rules pinned in rules/, then the
// same files as they were at the base, in a temp folder, so a finding the base already had is not
// new. Semgrep runs with metrics, the version check and its own nosemgrep handling off, on a local
// rules folder: a run never needs the network. Semgrep missing or failing is "could not run" (exit
// 2) with what to install, never a pass.

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { failClosed, type GateResult } from '../lib/contract.ts';
import { judged, newFindings, parseScan, PINNED_SEMGREP, sastSources, unpinned, type Finding, type Side, type Suppressed } from './core.ts';

export interface SastIo {
  /** Semgrep with these arguments in this folder; `error` when it could not be started. */
  semgrep(args: string[], cwd: string): { status: number | null; stdout: string; error?: Error };
  /** A changed file's text in the worktree, by its path there; undefined when it does not exist. */
  readHead(file: string): string | undefined;
  /** The file's text at the base; undefined when the base has no such file. */
  readBase(file: string): string | undefined;
  /** A new empty folder for the base files. */
  tempDir(): string;
  /** Writes the file, creating its folder. */
  write(path: string, text: string): void;
  remove(dir: string): void;
}

export interface SastOptions {
  /** The worktree; Semgrep runs there on paths relative to it. */
  cwd: string;
  /** The changed files, relative to cwd. */
  files: string[];
  /** The pinned rules folder. */
  rules: string;
}

export type SastResult = GateResult & {
  scanned?: string[];
  /** New ERROR findings: each blocks. */
  findings?: Finding[];
  /** New WARNING and INFO findings: reported, not blocking. */
  warnings?: Finding[];
  suppressed?: Suppressed[];
  notScanned?: string[];
  /** The Semgrep version that ran. */
  semgrep?: string;
  note?: string;
};

export const INSTALL_HINT = `Semgrep is not installed or not on PATH. Install the pinned version with \`pip install semgrep==${PINNED_SEMGREP}\` (Python 3.10 or later; Linux, macOS or Windows 11), then run the gate again.`;

/** Semgrep's arguments before the target files: local rules only, JSON out, nothing sent anywhere. */
export const SEMGREP_ARGS = (rules: string) => ['scan', '--config', rules, '--json', '--metrics=off', '--disable-version-check', '--disable-nosem', '--'];

function scan(files: string[], cwd: string, rules: string, io: SastIo) {
  const r = io.semgrep([...SEMGREP_ARGS(rules), ...files], cwd);
  if (r.error !== undefined) throw new Error((r.error as NodeJS.ErrnoException).code === 'ENOENT' ? INSTALL_HINT : `Semgrep could not start: ${r.error.message}`);
  return parseScan(r.stdout, r.status);
}

/** The base's findings on the files it has, scanned from copies in a temp folder that is always removed. */
function baseSide(files: string[], rules: string, io: SastIo): Side {
  const texts = new Map(files.flatMap((f) => {
    const text = io.readBase(f);
    return text === undefined ? [] : [[f, text] as const];
  }));
  // Stryker disable next-line ArrayDeclaration: equivalent; a made-up base finding has no rule, file or line, so it matches no head finding
  if (texts.size === 0) return { findings: [], texts };
  const dir = io.tempDir();
  try {
    for (const [f, text] of texts) io.write(join(dir, ...f.split('/')), text);
    return { findings: judged(scan([...texts.keys()], dir, rules, io).findings, texts).kept, texts };
  } finally {
    io.remove(dir);
  }
}

function judge(opts: SastOptions, io: SastIo): SastResult {
  const texts = new Map(sastSources(opts.files).flatMap((f) => {
    const text = io.readHead(f);
    return text === undefined ? [] : [[f, text] as const];
  }));
  const scanned = [...texts.keys()];
  if (scanned.length === 0) return { gate: 'sast', pass: true, scanned, findings: [], warnings: [], suppressed: [], notScanned: [] };
  const head = scan(scanned, opts.cwd, opts.rules, io);
  const { kept, suppressed } = judged(head.findings, texts);
  const fresh = newFindings({ findings: kept, texts }, baseSide(scanned, opts.rules, io));
  const findings = fresh.filter((f) => f.severity === 'ERROR');
  const warnings = fresh.filter((f) => f.severity !== 'ERROR');
  const note = unpinned(head.version);
  return { gate: 'sast', pass: findings.length === 0, scanned, findings, warnings, suppressed, notScanned: head.notScanned, semgrep: head.version, ...(note === undefined ? {} : { note }) };
}

/** The gate's verdict; Semgrep missing or failing is a result that could not run. */
export const sastGate = (opts: SastOptions, io: SastIo): SastResult => failClosed('sast', () => judge(opts, io));

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const findingLine = (label: string) => (f: Finding) => `${label} ${f.file}:${f.line} ${f.rule} (${f.severity}): ${oneLine(f.message)}`;

/** The result as lines for a person: each blocking finding and warning at its line, any note, or why it could not run. */
export function sastLines(r: SastResult): string[] {
  if (r.error !== undefined) return [`could not run: ${r.error}`];
  return [...(r.findings ?? []).map(findingLine('BLOCKING')), ...(r.warnings ?? []).map(findingLine('reported')), ...(r.note === undefined ? [] : [r.note])];
}

type Git = (args: string[]) => { status: number | null; stdout: string };

const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);

/** The files a change since `base` leaves in the worktree, committed or not, and the untracked ones. */
export function changedFiles(base: string, git: Git): string[] {
  const diff = git(['diff', '--name-only', '--diff-filter=d', base, '--']);
  if (diff.status !== 0) throw new Error(`git cannot diff against ${base}`);
  return [...new Set([...lines(diff.stdout), ...lines(git(['ls-files', '--others', '--exclude-standard']).stdout)])];
}

export type SastCliIo = Omit<SastIo, 'readBase'> & { git: Git };

/** The gate on these files against a git ref (HEAD for the Stop gate), the base files read with git show. */
export function sastSince(base: string, opts: SastOptions, io: SastCliIo): SastResult {
  const readBase = (file: string) => {
    const shown = io.git(['show', `${base}:${file}`]);
    return shown.status === 0 ? shown.stdout : undefined;
  };
  return sastGate(opts, { ...io, readBase });
}

const USAGE = 'usage: node gates/sast/cli.ts --base <ref> [--cwd <dir>] [--json <path>]';
const OPTIONS = { base: { type: 'string' }, cwd: { type: 'string' }, json: { type: 'string' } } as const;

/** What `node gates/sast/cli.ts` does: the gate on the files changed since --base in --cwd, written to --json too when given. */
export function sastCli(argv: string[], defaults: { rules: string; cwd?: string }, ioFor: (cwd: string) => SastCliIo): SastResult {
  const { base, cwd = defaults.cwd ?? '.', json } = parseArgs({ args: argv, options: OPTIONS }).values;
  if (base === undefined) throw new Error(USAGE);
  // Arguments go to git without a shell, but git would still read a leading dash as an option.
  if (base.startsWith('-')) throw new Error(`not a git ref: ${base}`);
  const io = ioFor(cwd);
  const result = sastSince(base, { cwd, files: changedFiles(base, io.git), rules: defaults.rules }, io);
  if (json !== undefined) io.write(json, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
