// The deciding parts of scripts/self-gate.ts, kept out of the shell so they are tested.

import { binCommand } from '../gates/lib/node-bin.ts';
import { join } from 'node:path';
import { coverageArgs } from '../gates/onkel/property-tests.ts';
import { DEFAULTS } from './runner-config.ts';

/** Every stage a self-gate run can have; each is logged as the gate `self-gate-<stage>` (ticket 31). */
export const SELF_GATE_STAGES = ['typecheck', 'unit', 'property', 'integration', 'locks', 'sast', 'onkel'] as const;
export type Stage = (typeof SELF_GATE_STAGES)[number];

export type Step = { id: Stage; name: string; command: string; args: string[] };

export type StepOptions = {
  /** Ticket ref supplied by --merge, including when HEAD is detached. */
  merge?: string;
  integration: boolean;
  /** Where the unit run writes vitest's JSON report, which names the slowest test files. */
  testJson: string;
  /** Merge mode: the unit run collects coverage here, for onkel's CRAP grading. */
  coverageDir?: string;
  /** Merge mode (ticket 56): the unit and property test files the change can reach; all when unset. */
  unitTests?: string[];
  /** Merge mode (ticket 56): the integration test files the change can reach; all when unset. */
  integrationTests?: string[];
  /** The vitest config the integration tests run with (config/runner.json, ticket 83); the default's when unset. */
  integrationConfig?: string;
};

const step = (id: Stage, name: string, [command, args]: [string, string[]]): Step => ({ id, name, command, args });

/** The step over the selected files, or over every file without a selection; none when the selection has none. */
function over(files: string[] | undefined, make: (files: string[]) => Step): Step[] {
  if (files === undefined) return [make([])];
  return files.length === 0 ? [] : [make(files)];
}

const isProperty = (f: string) => f.endsWith('.property.test.ts');

/** The unit run: once, and in merge mode with the coverage onkel grades CRAP from (property tests left out). */
function unitStep(root: string, o: StepOptions): Step[] {
  const json = ['--reporter=default', '--reporter=json', `--outputFile.json=${o.testJson}`];
  if (o.coverageDir === undefined) return [step('unit', 'unit tests', binCommand(root, 'vitest', ['run', ...json]))];
  const cov = coverageArgs(o.coverageDir);
  return [
    ...over(o.unitTests?.filter((f) => !isProperty(f)), (f) => step('unit', 'unit tests (with coverage)', binCommand(root, 'vitest', [...cov, '--coverage.reportOnFailure', ...json, ...f]))),
    ...over(o.unitTests?.filter(isProperty), (f) => step('property', 'property tests', binCommand(root, 'vitest', ['run', '--passWithNoTests', ...(o.unitTests === undefined ? ['property.test'] : f)]))),
  ];
}

const integrationStep = (root: string, o: StepOptions) =>
  over(o.integrationTests, (f) => step('integration', 'integration tests', binCommand(root, 'vitest', ['run', '--config', o.integrationConfig ?? DEFAULTS.integrationTests.config, ...f])));

/**
 * Typecheck and tests, each as `node <entry>`. They were `npx tsc` and `npm test` through a
 * shell on Windows only; process.execPath needs no shell on any platform (gates/lib/node-bin.ts).
 */
export function checkSteps(root: string, o: StepOptions): Step[] {
  return [
    step('typecheck', 'typecheck', binCommand(root, 'tsc', ['--noEmit'])),
    ...unitStep(root, o),
    ...(o.integration ? integrationStep(root, o) : []),
    { id: 'locks', name: 'locked files', command: process.execPath, args: [join(root, 'gates', 'locks', 'cli.ts'), ...(o.merge === undefined ? [] : ['--branch', o.merge])] },
  ];
}

/**
 * The fast merge gate's security rules (ticket 60): Semgrep's pinned rules (gates/sast) on the files
 * changed since the base, its result written to `json` for the observation log.
 */
export const sastStep = (base: string, json: string): Step => ({
  id: 'sast',
  name: 'sast (Semgrep security rules on the changed files)',
  command: process.execPath,
  args: ['gates/sast/cli.ts', '--base', base, '--json', json],
});

/** A step's exit as the gate contract reads it: 0 pass, 1 fail, anything else could not run. */
export const stepStatus = (status: number | null): 0 | 1 | 2 => (status === 0 || status === 1 ? status : 2);

const LABEL = ['pass', 'FAIL', 'COULD NOT RUN'] as const;

export const verdictLine = (r: { name: string; status: 0 | 1 | 2 }) => `  ${LABEL[r.status]}  ${r.name}`;

/** The summary line of a step: its verdict and its wall time. */
export const timedLine = (r: { name: string; status: 0 | 1 | 2; ms: number }) => `${verdictLine(r)}  ${(r.ms / 1000).toFixed(1)} s`;

export const worstExit = (statuses: number[]) => Math.max(0, ...statuses);
