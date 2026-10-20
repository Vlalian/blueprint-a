import { describe, expect, it, vi } from 'vitest';
import { exitCodeOf, toolchainProblem } from './run-core.ts';

describe('exitCodeOf: the gate contract for the onkel entry point', () => {
  it('passes the verdict through: 0 pass, 1 escalate', () => {
    expect(exitCodeOf(() => 0)).toBe(0);
    expect(exitCodeOf(() => 1)).toBe(1);
  });

  it('turns a crash into 2, "could not run", never into a plain fail', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(exitCodeOf(() => { throw new Error('Stryker produced no report'); })).toBe(2);
    expect(err.mock.calls.flat().join(' ')).toContain('onkel could not run: Stryker produced no report');
  });
});

describe('toolchainProblem: refuse a toolchain known to fake survivors', () => {
  it('accepts vitest 4', () => {
    expect(toolchainProblem('4.1.11')).toBeNull();
  });

  it('refuses vitest 5 and later, naming the reason', () => {
    expect(toolchainProblem('5.0.3')).toMatch(/vitest 5\.0\.3.*describe/);
    expect(toolchainProblem('6.0.0')).not.toBeNull();
  });

  it('reads the whole major version, not its first digit', () => {
    expect(toolchainProblem('10.0.0')).toMatch(/vitest 10\.0\.0/);
    expect(toolchainProblem('40.1.0')).not.toBeNull();
  });

  it('refuses when vitest is missing or its version is unreadable', () => {
    expect(toolchainProblem(undefined)).toMatch(/vitest not found/);
    expect(toolchainProblem('next')).toBe('cannot read the vitest version "next"');
  });
});
