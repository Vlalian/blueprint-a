/**
 * `/onkel` Mode A — the forward flow's gates, as a pure function.
 *
 * Mode A grades code written test-first, one ticket at a time, against a
 * standard known before it was written. So the gates are **absolute**: there
 * is no legacy here to be fair to, and "not worse than yesterday" is
 * meaningless for a function that did not exist yesterday. (Mode B, the
 * ratchet for the code already here, is a separate policy and is not built —
 * see `.scratch/onkel/PLAN.md`.)
 *
 * The verdict is computed from recorded numbers, and the agent obeys it. This
 * matters more than it looks: an agent allowed to judge whether its own work
 * is good enough has a very cheap way to decide that it is.
 *
 * There is no "close enough" verdict on purpose. Either the bar is met, or the
 * flow stops and asks — it never lowers its own bar.
 */

/**
 * Because a fully covered function scores exactly its complexity, this is in
 * effect a complexity cap of 6 on tested code. That is the intent.
 */
export const CRAP_CEILING = 6;

export type CrapScore = {
  name: string;
  file: string;
  startLine: number;
  endLine: number;
  crap: number;
};

/**
 * Statuses that mean the mutant was conclusively dealt with.
 *
 * `Timeout` counts as a kill — the mutant hung and the tests noticed.
 * `CompileError` is a mutant TypeScript rejected, so it never ran and says
 * nothing about the tests; Stryker excludes it from the score for the same
 * reason.
 */
export const CONCLUSIVE_KILLS = new Set(['Killed', 'Timeout', 'CompileError']);

/** Kills as the verdict counts them, split by status, so the summary and the verdict agree. */
export function killCount(mutants: MutantReport[]): { total: number; killed: number; timeout: number; compileError: number } {
  const of = (status: string) => mutants.filter((m) => m.status === status).length;
  const counts = { killed: of('Killed'), timeout: of('Timeout'), compileError: of('CompileError') };
  return { total: counts.killed + counts.timeout + counts.compileError, ...counts };
}

/** The part of Stryker's report this needs, per mutant. */
export type MutantReport = {
  file: string;
  line: number;
  mutator: string;
  /**
   * Stryker's status, deliberately typed as `string` rather than a union.
   *
   * This is data from another tool. The schema's enum today is Killed,
   * Survived, NoCoverage, CompileError, RuntimeError, Timeout, Ignored and
   * Pending — but a value this build has never seen has to arrive at the
   * policy *as itself* so it can be refused, not be cast into something it is
   * not. It was a union until CodeRabbit pointed out that `quality.ts` was
   * force-casting into it: an interrupted run emits `Pending`, which fell
   * through every branch and reported PASS. That is the same shape as the
   * `no-mutants` hole — absence of evidence reading as evidence.
   */
  status: string;
  /** Required when `status` is `Ignored`. */
  ignoreReason?: string;
  /** Ignored by something broader than a line-level directive naming it (decision #28). */
  broad?: boolean;
};

export type Failure =
  | { kind: 'crap'; name: string; file: string; line: number; detail: string }
  | { kind: 'mutant'; name: string; file: string; line: number; mutator: string; detail: string }
  | {
      kind: 'unexplained-suppression';
      name: string;
      file: string;
      line: number;
      mutator: string;
      detail: string;
    }
  | { kind: 'broad-suppression'; name: string; file: string; line: number; detail: string }
  | { kind: 'no-mutants'; name: string; file: string; line: number; detail: string }
  | { kind: 'untested'; name: string; file: string; line: number; detail: string }
  | { kind: 'missed-files'; name: string; file: string; line: number; detail: string }
  | {
      kind: 'inconclusive';
      name: string;
      file: string;
      line: number;
      mutator: string;
      detail: string;
    };

export type Verdict = {
  verdict: 'pass' | 'escalate';
  failures: Failure[];
  /** Mutants suppressed with a reason. Reported so they cannot creep. */
  suppressed: number;
  /** Stryker was skipped because CRAP failed first (decision #40). */
  mutationSkipped?: boolean;
};

function isExplainedSuppression(m: MutantReport): boolean {
  return m.status === 'Ignored' && m.broad !== true && (m.ignoreReason ?? '').trim() !== '';
}

/** What decision #28 accepts, said in every broad-suppression failure. */
const LINE_LEVEL_ONLY = 'only a line-level "disable next-line <mutator>: <reason>" is accepted';

/**
 * An ignored mutant's failure: hidden by an ignore broader than one line (decision #28), or
 * suppressed without saying why — a quieter way of failing, and otherwise the cheapest route
 * past this gate. Null for a line-level suppression with a reason.
 */
function suppressionFailure(m: MutantReport): Failure | null {
  const where = { name: m.mutator, file: m.file, line: m.line };
  if (m.broad === true) {
    return { kind: 'broad-suppression', ...where, detail: `suppressed by an ignore broader than one line (file, block, \`all\` or config); ${LINE_LEVEL_ONLY}` };
  }
  return isExplainedSuppression(m) ? null : { kind: 'unexplained-suppression', ...where, mutator: m.mutator, detail: 'suppressed with no reason given' };
}

/** Each broad directive in a graded file fails the run on its own (decision #28). */
function broadDirectiveFailures(directives: { file: string; line: number; text: string }[]): Failure[] {
  return directives.map((d) => ({
    kind: 'broad-suppression' as const,
    name: '(directive)',
    file: d.file,
    line: d.line,
    detail: `${d.text}: broader than one line; ${LINE_LEVEL_ONLY}`,
  }));
}

/** Functions whose CRAP is over the ceiling. */
function crapFailures(scores: CrapScore[]): Failure[] {
  return scores
    .filter((fn) => fn.crap > CRAP_CEILING)
    .map((fn) => ({
      kind: 'crap' as const,
      name: fn.name,
      file: fn.file,
      line: fn.startLine,
      detail: `CRAP ${fn.crap.toFixed(1)} exceeds the ceiling of ${CRAP_CEILING}`,
    }));
}

/**
 * A mutant that should have died and did not — or was suppressed without
 * saying why, which is a quieter way of failing and would otherwise be the
 * cheapest route past this gate.
 */
function mutantFailure(m: MutantReport): Failure | null {
  const where = { name: m.mutator, file: m.file, line: m.line, mutator: m.mutator };

  if (m.status === 'Ignored') return suppressionFailure(m);

  // NoCoverage is a survivor that never had to try.
  if (m.status === 'NoCoverage') {
    return { kind: 'mutant', ...where, detail: 'no test reaches this' };
  }
  if (m.status === 'Survived') {
    return { kind: 'mutant', ...where, detail: 'survived' };
  }
  if (CONCLUSIVE_KILLS.has(m.status)) return null;

  // Everything else — `RuntimeError`, `Pending` from an interrupted run, or a
  // status a later Stryker introduces — is a mutant nobody can say was caught.
  // Fail closed: the whole value of this gate is that it does not pass on the
  // absence of evidence.
  return {
    kind: 'inconclusive',
    ...where,
    detail: `status "${m.status}" is neither a kill nor a survival — the run did not settle this mutant`,
  };
}

/**
 * A run whose kills are all timeouts (decision #41): a hung mutant says the tests noticed
 * something, not that any assertion did, so with no `Killed` at all nothing shows a test can
 * tell the code from its mutants.
 */
function timeoutOnlyFailure(mutants: MutantReport[]): Failure[] {
  const kills = killCount(mutants);
  if (kills.killed > 0 || kills.timeout === 0) return [];
  return [
    {
      kind: 'inconclusive',
      name: '(run)',
      file: '(all)',
      line: 0,
      mutator: '(none)',
      detail: `no mutant was killed by a test; ${kills.timeout} timed out — the run proves nothing about the tests`,
    },
  ];
}

/** A named file Stryker never found was never mutated; the mutants of the rest are not the whole story. */
function missedFilesFailure(missedFiles: boolean | undefined): Failure[] {
  if (missedFiles !== true) return [];
  return [
    {
      kind: 'missed-files',
      name: '(files)',
      file: '(all)',
      line: 0,
      detail: 'Stryker found fewer files than it was handed — a named file was never mutated',
    },
  ];
}

/** Whether to skip the Stryker run (decision #40): a CRAP failure already escalates, and mutating costs minutes. */
export function skipsMutation(crap: CrapScore[]): boolean {
  return crapFailures(crap).length > 0;
}

type JudgeInput = {
  crap: CrapScore[];
  mutants: MutantReport[];
  /** Whether a mutation run happened at all; an empty result is only
   *  meaningful if one did. */
  ranMutation?: boolean;
  /** Files no test runs: Stryker stops with "No tests were executed" and writes no report. */
  untested?: string[];
  /** Stryker found fewer files than its `mutate` list named (scope.ts `strykerMissedFiles`). */
  missedFiles?: boolean;
  /** Stryker was not run because CRAP failed first (`skipsMutation`); the run has nothing to say. */
  mutationSkipped?: boolean;
  /** Stryker directives broader than one line in the graded files (suppressions.ts `broadDirectives`). */
  broadDirectives?: { file: string; line: number; text: string }[];
};

/** Everything the mutation run says against the change. */
function mutationFailures(input: JudgeInput): Failure[] {
  const untested = input.untested ?? [];
  const failures: Failure[] = [
    ...input.mutants.map(mutantFailure).filter((f): f is Failure => f !== null),
    ...untested.map((file) => ({
      kind: 'untested' as const,
      name: '(file)',
      file,
      line: 1,
      detail: 'no test runs this file; write tests first',
    })),
  ];

  // An empty mutation result reads exactly like a perfect one, and is not one:
  // it means the run never touched what the ticket changed. When the run stopped
  // because nothing was tested, `untested` already says so more precisely.
  if (input.ranMutation === true && input.mutants.length === 0 && untested.length === 0) {
    failures.push({
      kind: 'no-mutants',
      name: '(none)',
      file: '(all)',
      line: 0,
      detail: 'the mutation run produced no mutants — it did not cover the ticket',
    });
  }

  return [...failures, ...missedFilesFailure(input.missedFiles), ...timeoutOnlyFailure(input.mutants)];
}

export function judge(input: JudgeInput): Verdict {
  const mutationSkipped = input.mutationSkipped === true;
  const failures = [
    ...crapFailures(input.crap),
    ...broadDirectiveFailures(input.broadDirectives ?? []),
    ...(mutationSkipped ? [] : mutationFailures(input)),
  ];

  return {
    verdict: failures.length === 0 ? 'pass' : 'escalate',
    failures,
    suppressed: input.mutants.filter(isExplainedSuppression).length,
    mutationSkipped,
  };
}
