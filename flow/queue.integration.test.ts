// Decision 30 on the real file system with real processes: a run that claimed an item and then
// crashed leaves it in running/ only until the next claim. Ticket 07's "You see": a crashed run
// never leaves a ticket stuck in running.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { claimNext, enqueue } from './queue.ts';
import { queueFs } from './queue-fs.ts';

const url = (file: string) => JSON.stringify(pathToFileURL(join(import.meta.dirname, file)).href);

/** A separate node process that claims the next item of `root`, prints it and lives `ms` more. */
function claimer(root: string, ms: number): { pid: number; claimed: Promise<string>; exited: Promise<void> } {
  const code = `import { claimNext } from ${url('queue.ts')};
import { queueFs } from ${url('queue-fs.ts')};
process.stdout.write(String(claimNext(${JSON.stringify(root)}, queueFs)));
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});
process.exitCode = 1;`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return {
    pid: p.pid!,
    claimed: new Promise((resolve) => p.stdout.once('data', (d: Buffer) => resolve(d.toString()))),
    exited: new Promise((resolve) => p.on('close', () => resolve())),
  };
}

describe('the run queue on the real file system (decision 30)', () => {
  it('keeps an item busy while its claimer lives, and requeues it once the claimer has crashed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'queue-crash-'));
    enqueue(root, '10_a.md', 'A', queueFs);
    enqueue(root, '20_b.md', 'B', queueFs);
    const run = claimer(root, 1500);
    expect(await run.claimed).toBe('10_a.md');
    expect(JSON.parse(readFileSync(join(root, 'claims', '10_a.md'), 'utf8'))).toEqual({ pid: run.pid, host: hostname() });
    expect(() => claimNext(root, queueFs)).toThrow(`queue ${root} is busy: 10_a.md is still running`);

    await run.exited;
    expect(claimNext(root, queueFs)).toBe('10_a.md');
    expect(JSON.parse(readFileSync(join(root, 'claims', '10_a.md'), 'utf8'))).toEqual({ pid: process.pid, host: hostname() });
    expect(queueFs.list(join(root, 'ready'))).toEqual(['20_b.md']);
  });
});
