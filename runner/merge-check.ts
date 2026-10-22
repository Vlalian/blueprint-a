// A repo's own question for the merge mode (ticket 83). The runner's merge mode asks one more thing
// a repo may want before a merge, such as whether the owner chose the change (this repo's
// scripts/self-gate-chosen.ts): config/runner.json's `mergeCheck` names a module whose export
// `mergeCheck` answers it. The check's lines are printed before the gate, a refusal fails the merge,
// and the records of a merge that passed go to the observation log. None is asked when unset.

import type { Observation, ObservationBase } from './observations.ts';
import type { RunnerConfig } from './runner-config.ts';

/** git's output, or undefined when the command failed. */
export type GitOut = (args: string[]) => string | undefined;

export interface MergeVerdict {
  /** What the check says, printed before the gate runs. */
  lines: string[];
  /** Whether it refuses the merge. */
  refused: boolean;
  /** What a merge the gate passed logs, with the run's shared fields. */
  records(base: ObservationBase): Observation[];
}

/** The check: the branch being merged, the gate's base, and git. */
export type MergeCheck = (branch: string, base: string, git: GitOut) => MergeVerdict;

/**
 * The configured check, loaded by `load` (an import of the repo path); none when the config names
 * none. Throws, naming the module, when it has no `mergeCheck` function.
 */
export async function loadMergeCheck(config: Pick<RunnerConfig, 'mergeCheck'>, load: (path: string) => Promise<unknown>): Promise<MergeCheck | undefined> {
  if (config.mergeCheck === '') return undefined;
  const check = Object(await load(config.mergeCheck)).mergeCheck as unknown;
  if (typeof check !== 'function') throw new Error(`config/runner.json: mergeCheck ${config.mergeCheck} exports no mergeCheck function`);
  return check as MergeCheck;
}
