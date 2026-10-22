// The test selection records (ticket 56), kept apart so the observation log's type (observations.ts)
// can name them without an import cycle. Each is an observation with the usual five fields first:
// - selection: what the fast merge gate ran: every test (and why), or the test files the change
//   can reach (scripts/self-gate-select.ts), with the files the merge changed.
// - full-run: the whole suite, run when the integration branch is promoted to main or once a night when the PC is
//   idle (scripts/full-run.ts), with the test files that failed.
// - selection-miss: a test file that failed in a full run although no merge since the full run
//   before selected it; the files those merges changed are where the missing edge starts.

export type FullRunWhy = 'promote' | 'idle';

export type SelectionRecord =
  | { kind: 'selection'; sha: string; changed: string[]; all: boolean; reason: string; tests: string[] }
  | { kind: 'full-run'; sha: string; why: FullRunWhy; failing: string[]; ms: number }
  | { kind: 'selection-miss'; sha: string; test: string; merges: string[]; changed: string[] };
