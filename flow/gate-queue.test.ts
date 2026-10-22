import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail, fakeCli, memFs, memLock, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import { DEFAULTS } from './config.ts';
import { EMPTY_GATES, type GateQueue } from './gate-queue-state.ts';
import { gateQueue, heldLine, type GateQueueIo } from './gate-queue.ts';

const c = { ...DEFAULTS, integrationBranch: 'dev', gate: ['npm ci', 'npm run gate -- --base {base} --merge {branch}'] };
const QUEUE = join(ROOT, 'state', 'flow', 'gate-queue.json');
const WT = join(ROOT, '.worktrees', 'gate-queue');
const AT = '2026-10-21T10:00:00.000Z';
const LOG = join(ROOT, 'state', 'flow', 'logs', 'gate-71-2026-10-21T10-00-00-000Z.log');

const entry = (branch: string, ticket: string) => ({ ticket, branch, addedAt: 'then' });

function setup(o: { queue?: GateQueue; git?: Parameters<typeof fakeCli>[0]; fail?: string; files?: Record<string, string>; lock?: ReturnType<typeof memLock> } = {}) {
  const fs = memFs({ [QUEUE]: JSON.stringify(o.queue ?? EMPTY_GATES), ...o.files });
  const git = fakeCli({ 'rev-parse --verify origin/dev^{commit}': ok('b1\n'), 'rev-parse --verify origin/ticket/71-a^{commit}': ok('h71\n'), 'rev-parse --verify origin/ticket/72-b^{commit}': ok('h72\n'), ...o.git });
  const lock = o.lock ?? memLock();
  const shells: { command: string; cwd: string; log: string; env: Record<string, string> }[] = [];
  const out: string[] = [];
  const io: GateQueueIo = {
    root: ROOT,
    ...fs,
    acquire: lock.acquire,
    release: lock.release,
    git: git.run,
    platform: 'linux',
    logged: (command, cwd, log, env) => (shells.push({ command, cwd, log, env }), command.startsWith(o.fail ?? '-') ? 1 : 0),
    now: () => AT,
    out: (t) => void out.push(t),
  };
  return { io, fs, git, shells, out, lock, queue: () => fs.json(QUEUE) as GateQueue };
}

describe('flow gate-queue add and list', () => {
  it('adds a branch, with the remote in front or not, and lists the queue', () => {
    const s = setup();
    expect(gateQueue(['add', 'origin/ticket/71-a'], c, s.io)).toBe(0);
    expect(s.out).toEqual(['ticket/71-a queued for the merge gate (1 in the queue)\n']);
    expect(s.queue().queue).toEqual([{ ticket: '71', branch: 'ticket/71-a', addedAt: AT }]);
    s.out.length = 0;
    expect(gateQueue(['list'], c, s.io)).toBe(0);
    expect(s.out).toEqual([`Gate queue:\n1. ticket/71-a (queued ${AT})\nLatest results:\n(none)\n`]);
    gateQueue(['add', 'ticket/72-from-origin/x'], c, s.io);
    expect(s.out.at(-1)).toBe('ticket/72-from-origin/x is not a ticket/<NN-name> branch; not queued\n');
    gateQueue(['add', 'originx/72-b'], { ...c, branchPrefix: 'originx/' }, s.io);
    expect(s.queue().queue.at(-1)!.branch).toBe('originx/72-b');
  });

  it.each([[[]], [['add']], [['nope']], [['list', 'x']], [['run', 'x']], [['add', 'ticket/71-a', 'x']], [['list', 'x', 'y']]])('shows the usage for %j', (argv) => {
    const s = setup();
    expect(gateQueue(argv, c, s.io)).toBe(2);
    expect(s.out).toEqual(['usage: flow gate-queue add <ticket branch> | list | run\n']);
    expect(s.fs.writes).toEqual([]);
  });

  it('never overwrites a queue it cannot read', () => {
    const s = setup();
    s.fs.store.set(QUEUE, '{');
    expect(() => gateQueue(['add', 'ticket/71-a'], c, s.io)).toThrow(/gate-queue\.json could not be read/);
    expect(s.fs.read(QUEUE)).toBe('{');
  });
});

describe('the gate lock', () => {
  it('makes a second runner exit, saying who holds it', () => {
    const lock = memLock();
    lock.hold(JSON.stringify({ pid: 7, host: 'pc', startedAt: 'since', token: 'abc' }));
    const s = setup({ queue: { queue: [entry('ticket/71-a', '71')], results: [] }, lock });
    expect(gateQueue(['run'], c, s.io)).toBe(1);
    expect(s.out).toEqual(['Another gate runner holds the gate lock (pid 7 on pc, since since); exiting.\n']);
    expect(s.git.calls).toEqual([]);
    expect(heldLine(null)).toBe('Another gate runner holds the gate lock (its lock file could not be read); exiting.');
  });

  it("takes over a dead runner's lock, and releases it at the end", () => {
    const lock = memLock((pid) => pid !== 7);
    lock.hold(JSON.stringify({ pid: 7, host: 'pc', startedAt: 'since', token: 'abc' }));
    const s = setup({ lock });
    expect(gateQueue(['run'], c, s.io)).toBe(0);
    expect(s.out).toEqual(['Took over the gate lock of pid 7, which died.\n']);
    expect(s.fs.writes).toEqual([]);
    expect(lock.held()).toBeUndefined();
  });
});

describe('flow gate-queue run', () => {
  it("gates in the flow's own worktree: the integration branch and the ticket merged without a commit, then each configured command", () => {
    const s = setup({ queue: { queue: [entry('ticket/71-a', '71')], results: [] } });
    expect(gateQueue(['run'], c, s.io)).toBe(0);
    expect(s.git.calls.map((x) => [x.cwd === WT ? 'wt' : x.cwd === ROOT ? 'root' : x.cwd, x.args.join(' ')])).toEqual([
      ['root', 'fetch origin'],
      ['root', 'rev-parse --verify origin/dev^{commit}'],
      ['root', 'rev-parse --verify origin/ticket/71-a^{commit}'],
      ['root', `worktree add --detach ${WT} b1`],
      ['wt', 'merge --no-commit --no-ff origin/ticket/71-a'],
    ]);
    expect(s.shells).toEqual([
      { command: 'npm ci', cwd: WT, log: LOG, env: {} },
      { command: 'npm run gate -- --base "$FLOW_BASE" --merge "$FLOW_BRANCH"', cwd: WT, log: LOG, env: { FLOW_BASE: 'b1', FLOW_BRANCH: 'origin/ticket/71-a' } },
    ]);
    expect(s.queue()).toEqual({ queue: [], results: [{ ticket: '71', branch: 'ticket/71-a', head: 'h71', base: 'b1', status: 'green', log: LOG, at: AT }] });
    expect(s.out).toEqual(['gating ticket/71-a\n', `71  green  ticket/71-a @ h71 on b1  ${AT}  log ${LOG}\n`]);
    expect(s.fs.read(LOG)).toContain('$ git merge --no-commit --no-ff origin/ticket/71-a\n');
    expect(s.fs.read(LOG)).toContain('\n=== gate 2: npm run gate -- --base {base} --merge {branch}\n');
  });

  it('reuses its worktree with nothing left of the last gate', () => {
    const s = setup({ queue: { queue: [entry('ticket/71-a', '71')], results: [] }, files: { [join(WT, 'x')]: '' } });
    gateQueue(['run'], c, s.io);
    expect(s.git.calls.filter((x) => x.cwd === WT).map((x) => x.args.join(' '))).toEqual(['merge --abort', 'reset --hard -q', 'clean -fdq', 'checkout --detach -q b1', 'merge --no-commit --no-ff origin/ticket/71-a']);
  });

  it('stops a gate at the first failing command, named by its place, and goes on to the next ticket', () => {
    const s = setup({ queue: { queue: [entry('ticket/71-a', '71'), entry('ticket/72-b', '72')], results: [] }, fail: 'npm ci' });
    gateQueue(['run'], c, s.io);
    expect(s.queue().results.map((r) => [r.ticket, r.status, r.stage])).toEqual([
      ['71', 'red', 'gate 1'],
      ['72', 'red', 'gate 1'],
    ]);
    expect(s.shells.map((x) => x.command)).toEqual(['npm ci', 'npm ci']);
    const last = setup({ queue: { queue: [entry('ticket/71-a', '71')], results: [] }, fail: 'npm run' });
    gateQueue(['run'], c, last.io);
    expect(last.queue().results[0]!.stage).toBe('gate 2');
  });

  it('records a conflict at the merge, runs no command, and gates the next ticket', () => {
    const s = setup({ queue: { queue: [entry('ticket/71-a', '71'), entry('ticket/72-b', '72')], results: [] }, git: { 'merge --no-commit --no-ff origin/ticket/71-a': fail('CONFLICT') } });
    gateQueue(['run'], c, s.io);
    expect(s.queue().results.map((r) => [r.ticket, r.status, r.stage])).toEqual([
      ['71', 'conflict', 'merge'],
      ['72', 'green', undefined],
    ]);
    expect(s.shells).toHaveLength(2);
  });

  it.each([
    ['fetch origin', 'fetch', 'h71', 'b1'],
    ['rev-parse --verify origin/dev^{commit}', 'fetch', 'h71', ''],
    ['rev-parse --verify origin/ticket/71-a^{commit}', 'fetch', '', 'b1'],
    ['worktree add', 'worktree', 'h71', 'b1'],
  ])('is red at %s when `git %s` fails', (line, stage, head, base) => {
    const s = setup({ queue: { queue: [entry('ticket/71-a', '71')], results: [] }, git: { [line]: fail() } });
    gateQueue(['run'], c, s.io);
    expect(s.queue().results.map((r) => [r.status, r.stage, r.head, r.base])).toEqual([['red', stage, head, base]]);
    expect(s.shells).toEqual([]);
  });

  it.each(['reset --hard -q', 'clean -fdq', 'checkout --detach -q b1'])('is red at worktree when a reused worktree fails `git %s`', (line) => {
    const s = setup({ queue: { queue: [entry('ticket/71-a', '71')], results: [] }, files: { [join(WT, 'x')]: '' }, git: { [line]: fail(), 'merge --abort': fail('no merge') } });
    gateQueue(['run'], c, s.io);
    expect(s.queue().results.map((r) => [r.status, r.stage])).toEqual([['red', 'worktree']]);
  });

  it('gates a branch added while the queue runs in the same run', () => {
    const s = setup({ queue: { queue: [entry('ticket/71-a', '71')], results: [] } });
    const logged = s.io.logged;
    s.io.logged = (command, cwd, log, env) => (s.shells.length === 0 && gateQueue(['add', 'ticket/72-b'], c, s.io), logged(command, cwd, log, env));
    gateQueue(['run'], c, s.io);
    expect(s.queue().results.map((r) => r.ticket)).toEqual(['71', '72']);
  });
});
