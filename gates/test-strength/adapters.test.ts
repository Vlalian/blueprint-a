import { describe, expect, it } from 'vitest';
import { adapterFor } from './adapters.ts';
import { RUNNERS } from './gate.ts';

describe('adapterFor', () => {
  it.each(RUNNERS)('builds an adapter with the three calls for --runner %s, starting nothing yet', (runner) => {
    const adapter = adapterFor({ runner, cwd: '.', coverageFile: undefined } as Parameters<typeof adapterFor>[0]);
    expect([typeof adapter.coverage, typeof adapter.complexity, typeof adapter.mutate]).toEqual(['function', 'function', 'function']);
  });

  it('gives each language its own adapter', () => {
    const python = adapterFor({ runner: 'python', cwd: '.', coverageFile: undefined });
    const dotnet = adapterFor({ runner: 'dotnet', cwd: '.', coverageFile: undefined });
    const vitest = adapterFor({ runner: 'vitest', cwd: '.', coverageFile: undefined });
    expect(new Set([python.mutate.toString(), dotnet.mutate.toString(), vitest.mutate.toString()]).size).toBe(3);
  });
});
