import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail, fakeCli, memFs, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import { builds, done, type BuildsIo } from './builds.ts';
import { DEFAULTS } from './config.ts';

const c = { ...DEFAULTS, remote: 'up', integrationBranch: 'dev', stateDir: 'var' };
const QUEUE = join(ROOT, 'var', 'gate-queue.json');

const LIST = 'for-each-ref --format=%(refname:short) refs/remotes/up/ticket/';

const answers = {
  [LIST]: ok('up/ticket/1-merged\nup/ticket/2-queued\nup/ticket/3-gated\r\nup/ticket/4-done\nup/ticket/5-running\nup/ticket/notes\n'),
  'merge-base --is-ancestor up/ticket/1-merged up/dev': ok(),
  'merge-base --is-ancestor': fail(),
  'rev-parse up/ticket/1-merged': ok('h1\n'),
  'rev-parse up/ticket/2-queued': ok('h2\n'),
  'rev-parse up/ticket/3-gated': ok('h3\n'),
  'rev-parse up/ticket/4-done': ok('h4\n'),
  'rev-parse up/ticket/5-running': ok('h5\n'),
  'show up/ticket/4-done:docs/tickets/4-done.md': ok('# 4\n\n## Result\nBuilder: local\n'),
  'show up/ticket/5-running:docs/tickets/5-running.md': ok('# 5\n'),
  'show up/ticket/3-gated:docs/tickets/3-gated.md': ok('# 3\n'),
};

const queue = {
  queue: [{ ticket: '2', branch: 'ticket/2-queued', addedAt: 'x' }],
  results: [
    { ticket: '3', branch: 'ticket/3-gated', head: 'h3', base: 'b', status: 'red', log: 'l', at: 'x' },
    { ticket: '4', branch: 'ticket/4-done', head: 'old', base: 'b', status: 'green', log: 'l', at: 'x' },
  ],
};

function world(more: Record<string, ReturnType<typeof ok>> = {}) {
  const git = fakeCli({ ...answers, ...more });
  const fs = memFs({ [QUEUE]: JSON.stringify(queue) });
  const said: string[] = [];
  const io: BuildsIo = { root: ROOT, git: git.run, read: fs.read, out: (t) => void said.push(t) };
  return { git, io, said };
}

describe('the builds', () => {
  it('lists each ticket branch on the remote with its state, after a fetch', () => {
    const { git, io } = world();
    expect(builds(c, io)).toEqual([
      { ticket: '1', name: '1-merged', branch: 'ticket/1-merged', head: 'h1', state: 'merged' },
      { ticket: '2', name: '2-queued', branch: 'ticket/2-queued', head: 'h2', state: 'queued' },
      { ticket: '3', name: '3-gated', branch: 'ticket/3-gated', head: 'h3', state: 'gated' },
      { ticket: '4', name: '4-done', branch: 'ticket/4-done', head: 'h4', state: 'done' },
      { ticket: '5', name: '5-running', branch: 'ticket/5-running', head: 'h5', state: 'running' },
    ]);
    expect(git.lines()[0]).toBe('fetch up');
    expect(git.calls.every((call) => call.cwd === ROOT)).toBe(true);
  });

  it('is none when the branches cannot be listed, and running when the ticket file cannot be read', () => {
    expect(builds(c, world({ [LIST]: fail() }).io)).toEqual([]);
    expect(builds(c, world({ 'show up/ticket/4-done:docs/tickets/4-done.md': { status: 1, stdout: '## Result\n', stderr: '' } }).io).find((b) => b.ticket === '4')?.state).toBe('running');
    expect(builds(c, world({ 'rev-parse up/ticket/5-running': { status: 1, stdout: 'h5', stderr: '' } }).io).find((b) => b.ticket === '5')?.head).toBe('');
  });

  it('prints the done builds with the command that queues each', () => {
    const { io, said } = world({ 'rev-parse up/ticket/4-done': ok('h4aaaaaaaaaa\n'), 'rev-parse up/ticket/5-running': ok('h5bbbbbbbbbb\n'), 'show up/ticket/5-running:docs/tickets/5-running.md': ok('## Result\n') });
    expect(done(c, io)).toBe(0);
    expect(said).toEqual(['4  ticket/4-done @ h4aaaaa  (flow gate-queue add ticket/4-done)\n5  ticket/5-running @ h5bbbbb  (flow gate-queue add ticket/5-running)\n']);
  });

  it('says when no done build waits', () => {
    const { io, said } = world({ [LIST]: ok('') });
    done(c, io);
    expect(said).toEqual(['No finished build waits for the gate queue.\n']);
  });
});
