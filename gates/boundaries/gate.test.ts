import { describe, expect, it } from 'vitest';
import { boundariesGate } from './gate.ts';

const cycle = {
  type: 'cycle',
  from: 'src/a.ts',
  to: 'src/b.ts',
  rule: { severity: 'error', name: 'no-circular' },
  cycle: [{ name: 'src/b.ts' }, { name: 'src/a.ts' }],
};
const unresolvable = { type: 'dependency', from: 'src/a.ts', to: './missing.ts', rule: { severity: 'error', name: 'not-to-unresolvable' } };
const warning = { type: 'dependency', from: 'src/a.ts', to: 'src/c.ts', rule: { severity: 'warn', name: 'no-orphans' } };

const cruised = (violations: object[]) => ({ status: 0, stdout: JSON.stringify({ summary: { violations } }), stderr: '' });

describe('boundariesGate', () => {
  it('passes when dependency-cruiser reports no violations', () => {
    expect(boundariesGate({ cruise: () => cruised([]) })).toEqual({ gate: 'boundaries', pass: true, violations: [] });
  });

  it('fails on each error-level violation and names the rule, both ends and the cycle', () => {
    expect(boundariesGate({ cruise: () => cruised([cycle, unresolvable]) })).toEqual({
      gate: 'boundaries',
      pass: false,
      violations: [
        { rule: 'no-circular', from: 'src/a.ts', to: 'src/b.ts', cycle: ['src/b.ts', 'src/a.ts'] },
        { rule: 'not-to-unresolvable', from: 'src/a.ts', to: './missing.ts' },
      ],
    });
  });

  it('lets a warning-level violation through: only errors block', () => {
    expect(boundariesGate({ cruise: () => cruised([warning]) })).toEqual({ gate: 'boundaries', pass: true, violations: [] });
  });

  it('cannot run when dependency-cruiser printed no JSON (a missing path, a broken config)', () => {
    const crash = { status: 1, stdout: '', stderr: "\n  ERROR: Can't open 'nothere' for reading. Does it exist?\n\n" };
    expect(() => boundariesGate({ cruise: () => crash })).toThrow("dependency-cruiser could not run (exit 1): ERROR: Can't open 'nothere' for reading. Does it exist?");
  });

  it('cannot run on JSON without a summary, rather than passing it', () => {
    expect(() => boundariesGate({ cruise: () => ({ status: 0, stdout: '{}', stderr: '' }) })).toThrow('dependency-cruiser could not run (exit 0): ');
  });
});
