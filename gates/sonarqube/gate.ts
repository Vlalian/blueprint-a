// sonarqube: SonarQube's quality gate on the exact commit being shipped (ticket 59), with the
// same contract as ci-on-sha: VERIFIED when the analysis of that very commit passed its quality
// gate, FAILED when it failed (with the conditions that failed), NOT-VERIFIED otherwise: an
// analysis still running, one only of an older commit, a failed analysis, or no quality gate. A
// stale analysis is never a pass. The adapter (adapters/sonarqube) waits for the analysis; this
// reads it, and with it the new-code issues as findings and the new-code measures. The CLI wraps
// it in failClosed, so a missing token or server, or a server that cannot be read, exits 2.

import type { Verdict } from '../../adapters/host/host.ts';
import type { SonarRef } from '../../adapters/sonarqube/config.ts';
import { compareFindings, findingsOf, type OurFinding } from '../../adapters/sonarqube/findings.ts';
import type { AnalysisLook, QualityGate, SonarQubeAdapter } from '../../adapters/sonarqube/sonarqube.ts';
import type { GateResult } from '../lib/contract.ts';

export interface SonarQubeGateIo {
  /** The full SHA a ref names in the repo; throws when it names none. */
  resolveSha(ref: string): string;
  /** The analysis of the commit, after waiting for it as long as the project allows. */
  awaitAnalysis(sha: string, ref: SonarRef): AnalysisLook;
  sonar: Pick<SonarQubeAdapter, 'qualityGate' | 'newIssues' | 'newCodeMeasures'>;
}

export interface SonarQubeGateOptions {
  sha?: string;
  ref: SonarRef;
  /** Findings our own gates made on the same commit, to compare with SonarQube's. */
  ours?: OurFinding[];
}

const NOT_YET: Record<Exclude<AnalysisLook['state'], 'done'>, string> = {
  running: 'the analysis of this commit is still running',
  stale: 'the newest analysis is of an older commit',
  none: 'SonarQube has no analysis of this commit',
  failed: 'the analysis of this commit failed in SonarQube',
  unbound: "SonarQube's API names no commit for a pull request analysis: give the task the scanner submitted for this commit (ceTaskId in its report-task.txt)",
};

const VERDICTS = new Map<string, Verdict>([
  ['OK', 'VERIFIED'],
  ['ERROR', 'FAILED'],
]);

/** OK is VERIFIED, ERROR FAILED; NONE (no quality gate) or anything else NOT-VERIFIED. */
export const gateVerdict = (status: string): Verdict => VERDICTS.get(status) ?? 'NOT-VERIFIED';

function notVerified(sha: string, look: Exclude<AnalysisLook, { state: 'done' }>): GateResult {
  return { gate: 'sonarqube', pass: false, sha, verdict: 'NOT-VERIFIED', analysis: look.state, detail: NOT_YET[look.state], ...('revision' in look ? { analysedRevision: look.revision } : {}) };
}

function judged(sha: string, look: Extract<AnalysisLook, { state: 'done' }>, qg: QualityGate): GateResult {
  const verdict = gateVerdict(qg.status);
  const failing = qg.conditions.filter((c) => c.status === 'ERROR');
  return { gate: 'sonarqube', pass: verdict === 'VERIFIED', sha, verdict, analysis: 'done', analysisId: look.analysisId, boundBy: look.boundBy, qualityGate: qg.status, failing, conditions: qg.conditions };
}

export function sonarQubeGate(options: SonarQubeGateOptions, io: SonarQubeGateIo): GateResult {
  const sha = io.resolveSha(options.sha ?? 'HEAD');
  const look = io.awaitAnalysis(sha, options.ref);
  if (look.state !== 'done') return notVerified(sha, look);
  const findings = findingsOf(io.sonar.newIssues(options.ref), sha);
  return {
    ...judged(sha, look, io.sonar.qualityGate({ analysisId: look.analysisId })),
    measures: io.sonar.newCodeMeasures(options.ref),
    findings,
    ...(options.ours === undefined ? {} : { comparison: compareFindings(findings, options.ours) }),
  };
}
