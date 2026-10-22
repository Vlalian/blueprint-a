// The tempo records (ticket 53), kept apart from dispatcher/tempo.ts so the observation log's type
// (observations.ts) can name them without an import cycle. Each is an observation with the usual
// five fields first:
// - fire: a cloud build's routine was fired for this ticket branch (node scripts/tempo.ts fire).
// - build: a cloud build from its fire to the Result push on its branch (the commit that gave the
//   ticket's file its `## Result`), recorded when the branch is merged (node scripts/tempo.ts prep).
//   The routine's own finished_at is not the end of the build (ticket 41), so it is never used.
// - merge-prep: the merge's preparation before its gate: import, npm ci, functions, typecheck, each
//   with its ms; the gate's own stages are its `self-gate-<stage>` gate records (ticket 31).

export const SIZES = ['S', 'M', 'L'] as const;
export type Size = (typeof SIZES)[number];

export const PREP_STEPS = ['import', 'install', 'functions', 'typecheck'] as const;
export type PrepStep = (typeof PREP_STEPS)[number];

export type TempoRecord =
  | { kind: 'fire'; branch: string; size?: Size }
  | { kind: 'build'; branch: string; size?: Size; firedAt: string; resultAt: string; ms: number }
  | { kind: 'merge-prep'; branch: string; steps: { step: PrepStep; ms: number; ok: boolean }[]; ms: number };
