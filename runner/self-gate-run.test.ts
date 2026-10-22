import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverageArgs } from '../gates/onkel/property-tests.ts';
import { checkSteps, sastStep, SELF_GATE_STAGES, stepStatus, timedLine, verdictLine, worstExit } from './self-gate-run.ts';

const ROOT = resolve(import.meta.dirname, '..');
// Node resolves through a symlinked or junctioned node_modules (Stryker's sandbox) to the real path.
const entry = (...parts: string[]) => realpathSync(join(ROOT, 'node_modules', ...parts));

describe('checkSteps — typecheck and tests, each started through node itself', () => {
  const vitest = entry('vitest', 'vitest.mjs');
  const json = ['--reporter=default', '--reporter=json', '--outputFile.json=/runs/tests.json'];

  // npx and npm are .cmd shims on Windows; spawnSync cannot start them without a shell.
  it('runs tsc and vitest as process.execPath with their JS entries, never npx or npm, the unit run writing its JSON report', () => {
    expect(checkSteps(ROOT, { integration: false, testJson: '/runs/tests.json' })).toEqual([
      { id: 'typecheck', name: 'typecheck', command: process.execPath, args: [entry('typescript', 'bin', 'tsc'), '--noEmit'] },
      { id: 'unit', name: 'unit tests', command: process.execPath, args: [vitest, 'run', ...json] },
      { id: 'locks', name: 'locked files', command: process.execPath, args: [join(ROOT, 'gates', 'locks', 'cli.ts')] },
    ]);
  });

  it('adds the integration tests only when asked', () => {
    expect(checkSteps(ROOT, { integration: true, testJson: '/runs/tests.json' })[2]).toEqual({
      id: 'integration',
      name: 'integration tests',
      command: process.execPath,
      args: [vitest, 'run', '--config', 'vitest.integration.config.ts'],
    });
    expect(checkSteps(ROOT, { integration: true, testJson: '/runs/tests.json' })).toHaveLength(4);
  });

  it('runs the integration tests with the configured vitest config (ticket 83)', () => {
    expect(checkSteps(ROOT, { integration: true, testJson: '/runs/tests.json', integrationConfig: 'vitest.slow.config.ts' })[2].args).toEqual([vitest, 'run', '--config', 'vitest.slow.config.ts']);
  });

  it('passes the merge ref to the locks stage for detached integration worktrees', () => {
    expect(checkSteps(ROOT, { integration: true, testJson: '/runs/tests.json', merge: 'origin/ticket/67-x' }).at(-1)?.args)
      .toEqual([join(ROOT, 'gates', 'locks', 'cli.ts'), '--branch', 'origin/ticket/67-x']);
  });

  it('in merge mode runs the unit suite once, with v8 json coverage for CRAP, and the property tests on their own (ticket 31)', () => {
    const steps = checkSteps(ROOT, { integration: false, testJson: '/runs/tests.json', coverageDir: '/runs/cov' });
    expect(steps.map((s) => s.id)).toEqual(['typecheck', 'unit', 'property', 'locks']);
    expect(steps[1]).toEqual({
      id: 'unit',
      name: 'unit tests (with coverage)',
      command: process.execPath,
      args: [vitest, ...coverageArgs('/runs/cov'), '--coverage.reportOnFailure', ...json],
    });
    // Property tests never count towards coverage (gates/onkel/property-tests.ts), so they run apart.
    expect(steps[2]).toEqual({ id: 'property', name: 'property tests', command: process.execPath, args: [vitest, 'run', '--passWithNoTests', 'property.test'] });
  });

  it('in merge mode runs only the selected test files, each stage its own kind (ticket 56)', () => {
    const steps = checkSteps(ROOT, {
      integration: true,
      testJson: '/runs/tests.json',
      coverageDir: '/runs/cov',
      unitTests: ['a.test.ts', 'b.property.test.ts', 'c.test.ts'],
      integrationTests: ['d.integration.test.ts'],
    });
    expect(steps.map((s) => s.args.slice(-2))).toEqual([
      [entry('typescript', 'bin', 'tsc'), '--noEmit'].slice(-2),
      ['a.test.ts', 'c.test.ts'],
      ['--passWithNoTests', 'b.property.test.ts'],
      ['vitest.integration.config.ts', 'd.integration.test.ts'],
      [join(ROOT, 'gates', 'locks', 'cli.ts')],
    ]);
    expect(steps[1].args.slice(0, -2)).toEqual([vitest, ...coverageArgs('/runs/cov'), '--coverage.reportOnFailure', ...json]);
  });

  it('leaves out a stage whose selection is empty, and runs every integration test without one', () => {
    const none = checkSteps(ROOT, { integration: true, testJson: '/runs/tests.json', coverageDir: '/runs/cov', unitTests: [], integrationTests: [] });
    expect(none.map((s) => s.id)).toEqual(['typecheck', 'locks']);
    const onlyProperty = checkSteps(ROOT, { integration: true, testJson: '/runs/tests.json', coverageDir: '/runs/cov', unitTests: ['p.property.test.ts'] });
    expect(onlyProperty.map((s) => s.id)).toEqual(['typecheck', 'property', 'integration', 'locks']);
    expect(onlyProperty[2].args).toEqual([vitest, 'run', '--config', 'vitest.integration.config.ts']);
  });
});

describe('SELF_GATE_STAGES', () => {
  it('names every stage a self-gate run can have, each a gate in the function registry', () => {
    expect(SELF_GATE_STAGES).toEqual(['typecheck', 'unit', 'property', 'integration', 'locks', 'sast', 'onkel']);
  });
});

describe('timedLine', () => {
  it('labels each step by its exit code and says how long it took', () => {
    expect(timedLine({ name: 'typecheck', status: 0, ms: 12_345 })).toBe('  pass  typecheck  12.3 s');
    expect(timedLine({ name: 'onkel', status: 1, ms: 60 })).toBe('  FAIL  onkel  0.1 s');
  });
});

describe('stepStatus', () => {
  it('keeps 0, 1 and 2 and turns anything else (a crash, a missing status) into 2, could not run', () => {
    expect([0, 1, 2, 3, 127, null].map(stepStatus)).toEqual([0, 1, 2, 2, 2, 2]);
  });
});

describe('verdictLine', () => {
  it('labels each step by its exit code', () => {
    expect(verdictLine({ name: 'typecheck', status: 0 })).toBe('  pass  typecheck');
    expect(verdictLine({ name: 'onkel', status: 1 })).toBe('  FAIL  onkel');
    expect(verdictLine({ name: 'tests', status: 2 })).toBe('  COULD NOT RUN  tests');
  });
});

describe('worstExit', () => {
  it('is the worst step: could-not-run beats fail beats pass', () => {
    expect(worstExit([0, 0])).toBe(0);
    expect(worstExit([0, 1, 0])).toBe(1);
    expect(worstExit([1, 2, 0])).toBe(2);
  });
});

describe('sastStep', () => {
  it('runs the sast gate as node <entry> on the changes since the base, writing its JSON (ticket 60)', () => {
    expect(sastStep('base1', join('runs', 'sast.json'))).toEqual({
      id: 'sast',
      name: 'sast (Semgrep security rules on the changed files)',
      command: process.execPath,
      args: ['gates/sast/cli.ts', '--base', 'base1', '--json', join('runs', 'sast.json')],
    });
  });
});

it('includes the lock backstop in normal and merge self-gates', () => {
  for (const options of [{ integration: false, testJson: 'tests.json' }, { integration: false, testJson: 'tests.json', coverageDir: 'cov', unitTests: [] }]) {
    expect(checkSteps(ROOT, options).at(-1)).toEqual({ id: 'locks', name: 'locked files', command: process.execPath, args: [join(ROOT, 'gates', 'locks', 'cli.ts')] });
  }
});
