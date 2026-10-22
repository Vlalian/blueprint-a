// Decisions 30 and 44 on the real file system with real processes: takers racing for one lock,
// and a holder that crashed. Ticket 07's Pass when "a dead-pid lock is taken over".
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { acquire, release, type Acquired } from './lock.ts';
import { lockFs } from './lock-fs.ts';

const url = (file: string) => JSON.stringify(pathToFileURL(join(import.meta.dirname, file)).href);

/** A separate node process that runs `body` with acquire, release and lockFs in scope. */
function child(body: string): Promise<{ pid: number; out: string; code: number | null }> {
  const code = `import { acquire, release } from ${url('lock.ts')};\nimport { lockFs } from ${url('lock-fs.ts')};\n${body}`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d: Buffer) => void (out += d.toString()));
  return new Promise((resolve) => p.on('close', (exit) => resolve({ pid: p.pid!, out, code: exit })));
}

/**
 * A taker that waits for the shared start time, tries once, prints the result and keeps its lock
 * until `holdUntil`, so no taker can see the winner dead and take over from it.
 */
const taker = (path: string, startAt: number, holdUntil: number) =>
  child(`
while (Date.now() < ${startAt}) {}
const r = acquire(lockFs(${JSON.stringify(path)}));
process.stdout.write(JSON.stringify(r));
const wait = ${holdUntil} - Date.now();
if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
`);

async function race(path: string, takers: number): Promise<Acquired[]> {
  const startAt = Date.now() + 2000;
  const runs = await Promise.all(Array.from({ length: takers }, () => taker(path, startAt, startAt + 1500)));
  return runs.map((r) => JSON.parse(r.out) as Acquired);
}

const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;
const fresh = () => join(mkdtempSync(join(tmpdir(), 'lock-race-')), 'run.lock');

describe('the lock on the real file system (decisions 30 and 44)', () => {
  it('lets exactly one of eight racing takers have a free lock', async () => {
    for (let round = 0; round < 3; round++) {
      const results = await race(fresh(), 8);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toHaveLength(7);
    }
  });

  it("lets exactly one of eight racing takers take over a dead holder's lock, and leaves no file aside", async () => {
    for (let round = 0; round < 3; round++) {
      const path = fresh();
      const dead = { pid: deadPid(), host: hostname(), startedAt: '2026-10-04T08:00:00.000Z', token: 'dead' };
      writeFileSync(path, JSON.stringify(dead));
      const results = await race(path, 8);
      const winners = results.filter((r) => r.ok);
      expect(winners).toHaveLength(1);
      expect(readdirSync(join(path, '..'))).toEqual(['run.lock']);
      expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe((winners[0] as { token: string }).token);
    }
  });

  it('takes over the lock of a holder process that crashed without releasing it (ticket 07 Pass when)', async () => {
    const path = fresh();
    const crashed = await child(`const r = acquire(lockFs(${JSON.stringify(path)})); process.stdout.write(JSON.stringify(r)); process.exitCode = 1;`);
    expect(JSON.parse(crashed.out)).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ pid: crashed.pid, host: hostname() });

    const mine = acquire(lockFs(path));
    expect(mine).toMatchObject({ ok: true, takenOverFrom: { pid: crashed.pid, host: hostname() } });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ pid: process.pid });
    expect(release((mine as { token: string }).token, lockFs(path))).toBe(true);
  });

  it('refuses the lock while its holder process is alive, and never lets a reused pid release it', async () => {
    const path = fresh();
    const mine = acquire(lockFs(path));
    const other = await child(`
const io = lockFs(${JSON.stringify(path)});
process.stdout.write(JSON.stringify({ acquired: acquire(io), released: release('not-the-token', io) }));`);
    expect(JSON.parse(other.out)).toEqual({ acquired: { ok: false, heldBy: expect.objectContaining({ pid: process.pid }) }, released: false });
    expect(release((mine as { token: string }).token, lockFs(path))).toBe(true);
  });

  it("treats another host's lock as held, even with a pid that is dead here", () => {
    const path = fresh();
    const remote = { pid: deadPid(), host: `${hostname()}-cloud`, startedAt: '2026-10-04T08:00:00.000Z', token: 'remote' };
    writeFileSync(path, JSON.stringify(remote));
    expect(acquire(lockFs(path))).toEqual({ ok: false, heldBy: remote });
  });
});
