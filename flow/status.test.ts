import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail, fakeCli, memFs, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import { DEFAULTS } from './config.ts';
import { status, table, type StatusIo } from './status.ts';

const LIST = 'for-each-ref --format=%(refname:short) refs/remotes/origin/ticket/';
const c = { ...DEFAULTS, buildCap: 2 };

function world(branches: string[], files: Record<string, unknown> = {}) {
  const answers: Record<string, ReturnType<typeof ok>> = { [LIST]: ok(branches.map((b) => `origin/ticket/${b}\n`).join('')), 'merge-base --is-ancestor origin/ticket/1-old origin/main': ok(), 'merge-base --is-ancestor': fail() };
  for (const b of branches) answers[`rev-parse origin/ticket/${b}`] = ok(`${b.padEnd(8, '0')}\n`);
  answers['show origin/ticket/3-built:docs/tickets/3-built.md'] = ok('## Result\n');
  const fs = memFs(Object.fromEntries(Object.entries(files).map(([k, v]) => [join(ROOT, 'state', 'flow', k), JSON.stringify(v)])));
  const said: string[] = [];
  const io: StatusIo = { root: ROOT, git: fakeCli(answers).run, read: fs.read, out: (t) => void said.push(t) };
  return { io, said: () => said.join('') };
}

describe('a table', () => {
  it('pads each column to its widest cell and trims each line', () => {
    expect(table([['a', 'bbb', 'c'], ['dddd', 'e', '']])).toBe('a     bbb  c\ndddd  e');
  });
});

describe('flow status', () => {
  it('shows the open builds, the gate queue, the latest gates and the builds in flight against the cap', () => {
    const gates = {
      queue: [{ ticket: '3', branch: 'ticket/3-built', addedAt: 'today' }],
      results: [
        { ticket: '2', branch: 'ticket/2-run', head: 'h'.repeat(40), base: 'b'.repeat(40), status: 'red', stage: 'gate 1', log: 'l', at: 'x' },
        { ticket: '1', branch: 'ticket/1-old', head: 'o', base: 'o', status: 'green', log: 'l', at: 'x' },
        { ticket: '3', branch: 'ticket/3-built', head: 'g'.repeat(40), base: 'b'.repeat(40), status: 'green', log: 'l', at: 'x' },
      ],
    };
    const { io, said } = world(['1-old', '2-run', '3-built'], { 'gate-queue.json': gates, 'in-flight.json': [{ branch: 'ticket/2-run', family: 'local', at: 'noon' }] });
    expect(status(c, io)).toBe(0);
    expect(said()).toBe(
      [
        'what        item              state          detail',
        'build       2 ticket/2-run    running        2-run00',
        'build       3 ticket/3-built  queued         3-built',
        'gate queue  ticket/3-built    queued         today',
        'gate        2 ticket/2-run    red at gate 1  hhhhhhh on bbbbbbb',
        'gate        3 ticket/3-built  green          ggggggg on bbbbbbb',
        'in flight   ticket/2-run      local          since noon',
        'build cap   1 of 2            ok             every family together',
        '',
      ].join('\n'),
    );
  });

  it('warns under the table when the builds in flight break the cap', () => {
    const { io, said } = world(['4-a', '5-b', '6-c']);
    status(c, io);
    expect(said()).toContain('in flight  ticket/4-a    unrecorded  no Result yet\n');
    expect(said()).toContain('build cap  3 of 2        exceeded    every family together\n');
    expect(said().endsWith('\nWarning: 3 builds in flight (unrecorded 3): more than the cap of 2, every family counted together\n')).toBe(true);
  });
});
