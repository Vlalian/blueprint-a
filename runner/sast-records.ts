// The sast gate's findings as observations (ticket 60), so the improver (ticket 42) and the
// evaluation count its catches against its cost: each new blocking (ERROR) finding and each reported
// (WARNING, INFO) one is a `finding` with source `sast`, its rule as the id, its severity, file and
// line, and gate `sast`; each reasoned suppression is a `suppression` of gate `sast` (ticket 15b
// counts it as a false alarm). The gate's own verdict and time are its `gate` record, made where it
// runs (the Stop gate, the self-gate's sast stage). Pure.

import type { Finding, Suppressed } from '../gates/sast/core.ts';
import type { SastResult } from '../gates/sast/gate.ts';
import type { Observation, ObservationBase } from './observations.ts';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

const findingRecord = (base: ObservationBase, sha: string, fate: 'blocking' | 'reported') => (f: Finding): Observation => ({
  ...base,
  kind: 'finding',
  source: 'sast',
  id: f.rule,
  severity: f.severity,
  axis: 'security',
  file: f.file,
  line: f.line,
  summary: oneLine(f.message),
  fate,
  reason: '',
  gate: 'sast',
  sha,
});

const suppressionRecord = (base: ObservationBase) => (s: Suppressed): Observation => ({ ...base, kind: 'suppression', gate: 'sast', file: `${s.file}:${s.line}`, reason: `${s.rule}: ${s.reason}` });

/** One record per new finding and per suppression of a sast run; none when it could not run. */
export function sastObservations(base: ObservationBase, sha: string, r: SastResult): Observation[] {
  return [
    ...(r.findings ?? []).map(findingRecord(base, sha, 'blocking')),
    ...(r.warnings ?? []).map(findingRecord(base, sha, 'reported')),
    ...(r.suppressed ?? []).map(suppressionRecord(base)),
  ];
}
