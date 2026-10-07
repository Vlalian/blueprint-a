// The hardener's gate: onkel (CRAP + every mutant killed) on each source file the ticket changed,
// with its I/O passed in so it is tested in-process. cli.ts only wires in git and onkel.
// On this repo itself (the workflow project, ticket 41: `--self`) it grades as the self-gate does:
// only the files the self-gate grades, with its onkel flags (scripts/self-gate-core.ts selfOnkelFlags).
// Exit 0 pass, 1 fail (onkel's escalate), 2 could not run.

export interface HardenerIo {
  /** `git diff --name-only` since base, deletions left out. */
  diffNames(base: string): string;
  /** `git ls-files --others --exclude-standard`. */
  untracked(): string;
  /** Runs onkel with these arguments and returns its exit status (null when it was killed). */
  onkel(args: string[]): number | null;
  log(line: string): void;
  /** On this repo (`--self`, ticket 41): the self-gate's onkel flags, and which changed files it grades. */
  self?: { flags: string[]; graded(files: string[]): string[] };
}

/** The changed files onkel grades: TypeScript sources, not tests, declarations or dependencies. */
export function gradedSources(changed: string[]): string[] {
  return changed.filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts') && !p.startsWith('node_modules/'));
}

/**
 * Printed under onkel's report when it escalates, so the hardener reads it at the moment it is
 * blocked and the Stop gate's escalation carries it: a mutant no test can kill is simplified
 * away by the cleaner in an extra round (ticket 40), and suppressed (line-level, with a reason) only when nothing simpler exists.
 */
export const EQUIVALENT_MUTANT_HINT = [
  'hardener: a mutant no test can kill (equivalent) is not yours to suppress. End with the exact edit that removes it,',
  '  SIMPLIFY <the mutant file>:<its line> / before: <the line as it is> / after: <the line simplified> / why: <why no caller can tell>,',
  '  for the cleaner to apply; only when no simpler code exists, SUPPRESS <file>:<line> <Mutator> with the',
  '  line-level comment and its reason. See skills/hardener/SKILL.md, rule 7.',
].join('\n');

/** onkel's flags: the base, and --json when a cloud role's gate (ticket 32) asks for its result as data. */
const onkelFlags = (base: string, json: string | undefined) => ['--base', base, ...(json ? ['--json', json] : [])];

/** The changed files onkel grades; on this repo, only those the self-gate grades. */
function changedSources(base: string, io: HardenerIo): string[] {
  const sources = gradedSources(`${io.diffNames(base)}\n${io.untracked()}`.split('\n'));
  return io.self ? io.self.graded(sources) : sources;
}

const selfFlags = (io: HardenerIo) => io.self?.flags ?? [];

export function hardenerGate(opts: { base?: string; json?: string }, io: HardenerIo): number {
  if (!opts.base) {
    io.log('usage: node gates/hardener/cli.ts --base <ref>');
    return 2;
  }
  const files = changedSources(opts.base, io);
  if (files.length === 0) {
    io.log(`hardener: no source file changed since ${opts.base}; nothing for onkel to grade.`);
    return 0;
  }
  const status = io.onkel([...onkelFlags(opts.base, opts.json), ...selfFlags(io), ...files]) ?? 2;
  if (status === 1) io.log(EQUIVALENT_MUTANT_HINT);
  return status;
}
