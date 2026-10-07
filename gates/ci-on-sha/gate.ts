// ci-on-sha: passes only when CI is green on the exact commit being shipped (blueprint B: "CI green
// on the exact SHA before ready"). Green on an earlier commit of the branch counts for nothing;
// pending fails too. One look, no waiting: scripts/watch-pr waits. CI is read through the host
// adapter (adapters/host, ticket 54), so the gate is the same on GitHub and Azure DevOps; its
// verdict is VERIFIED, FAILED or NOT-VERIFIED in the ledger's words. The CLI wraps this in
// failClosed, so a host that cannot be read exits 2.

import { verdictOf, type HostAdapter } from '../../adapters/host/host.ts';
import type { GateResult } from '../lib/contract.ts';

export interface CiOnShaIo {
  /** The full SHA a ref names in the repo; throws when it names none. */
  resolveSha(ref: string): string;
  host: Pick<HostAdapter, 'host' | 'checksForCommit'>;
}

export function ciOnShaGate(options: { sha?: string }, io: CiOnShaIo): GateResult {
  const ci = io.host.checksForCommit(io.resolveSha(options.sha ?? 'HEAD'));
  return { gate: 'ci-on-sha', pass: ci.state === 'green', host: io.host.host, sha: ci.sha, ci: ci.state, verdict: verdictOf(ci.state), passed: ci.passed, failing: ci.failing, pending: ci.pending };
}
