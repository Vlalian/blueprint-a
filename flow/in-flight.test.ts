import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail, fakeCli, memFs, memLock, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import type { Build } from './builds.ts';
import { DEFAULTS, type Family } from './config.ts';
import { buildsInFlight, byFamily, capWarning, endBuild, flowInFlight, readInFlight, reserveBuild, UNRECORDED, type InFlight, type InFlightIo } from './in-flight.ts';

const FILE = join(ROOT, 'state', 'flow', 'in-flight.json');
const AT = '2026-10-21T20:00:00.000Z';
const family = (name: string): Family => ({ name, build: 'b', review: 'r', timeoutMs: 1 });
const c = { ...DEFAULTS, families: [family('local'), family('cloud')] };

function setup(recorded?: InFlight[] | string, git = fakeCli().run) {
  const fs = memFs(recorded === undefined ? {} : { [FILE]: typeof recorded === 'string' ? recorded : JSON.stringify(recorded) });
  const out: string[] = [];
  const lock = memLock();
  const locks: string[] = [];
  const io: InFlightIo = { root: ROOT, lock: (p) => (locks.push(p), lock), git, read: fs.read, write: fs.write, now: () => AT, out: (t) => void out.push(t) };
  return { io, fs, out, lock, locks, recorded: () => fs.json(FILE) as InFlight[] };
}

const build = (ticket: string, state: Build['state']): Build => ({ ticket, name: `${ticket}-x`, branch: `ticket/${ticket}-x`, head: 'h', state });
const flight = (branch: string, family: string): InFlight => ({ branch, family, at: 'then' });

describe('the recorded builds', () => {
  it('are none without a file; a file that cannot be read is named', () => {
    expect(readInFlight(c, setup().io)).toEqual([]);
    expect(() => readInFlight(c, setup('{').io)).toThrow(/^in-flight\.json could not be read: /);
  });

  it("live in the configured state folder under git's common directory, relative or absolute", () => {
    const rel = setup(undefined, fakeCli({ 'rev-parse --git-common-dir': ok('.git\n') }).run);
    rel.fs.store.set(join(ROOT, '.git', 'var', 'in-flight.json'), JSON.stringify([flight('ticket/1-x', 'local')]));
    expect(readInFlight({ stateDir: 'var' }, rel.io)).toEqual([flight('ticket/1-x', 'local')]);
    const abs = resolve('/', 'common');
    const s = setup(undefined, fakeCli({ 'rev-parse --git-common-dir': ok(`${abs}\n`) }).run);
    flowInFlight(['start', 'ticket/2-y', 'cloud'], c, s.io);
    expect(s.fs.json(join(abs, 'state', 'flow', 'in-flight.json'))).toEqual([{ branch: 'ticket/2-y', family: 'cloud', at: AT }]);
    expect(s.locks).toEqual([`${join(abs, 'state', 'flow', 'in-flight.json')}.lock`]);
  });

  it('cannot be found when git names no common directory', () => {
    const s = setup(undefined, fakeCli({ 'rev-parse --git-common-dir': fail() }).run);
    expect(() => readInFlight(c, s.io)).toThrow('git cannot name its common directory, where the flow keeps in-flight.json');
  });
});

describe('Pass when: more builds in flight than the configured cap make flow status warn', () => {
  it('counts the recorded builds and each running build not recorded', () => {
    const builds = [build('1', 'running'), build('2', 'running'), build('3', 'done')];
    expect(buildsInFlight(builds, [flight('ticket/1-x', 'local'), flight('ticket/9-z', 'cloud')])).toEqual([
      { branch: 'ticket/1-x', family: 'local' },
      { branch: 'ticket/9-z', family: 'cloud' },
      { branch: 'ticket/2-x', family: UNRECORDED },
    ]);
  });

  it('warns only above the cap, naming the count of each family', () => {
    const four = [flight('a', 'local'), flight('b', 'cloud'), flight('c', 'local'), flight('d', UNRECORDED)];
    expect(byFamily(four)).toBe('local 2, cloud 1, unrecorded 1');
    expect(capWarning(four.slice(0, 3), c)).toBeUndefined();
    expect(capWarning(four, c)).toBe('4 builds in flight (local 2, cloud 1, unrecorded 1): more than the cap of 3, every family counted together');
    expect(capWarning(four.slice(0, 2), { buildCap: 1 })).toBe('2 builds in flight (local 1, cloud 1): more than the cap of 1, every family counted together');
  });
});

describe('flow in-flight', () => {
  it('records a start by a configured family, replacing one of the same branch', () => {
    const s = setup([flight('ticket/1-x', 'local'), flight('ticket/2-y', 'cloud')]);
    expect(flowInFlight(['start', 'ticket/1-x', 'cloud'], c, s.io)).toBe(0);
    expect(s.recorded()).toEqual([flight('ticket/2-y', 'cloud'), { branch: 'ticket/1-x', family: 'cloud', at: AT }]);
    expect(s.out).toEqual(['Recorded a cloud build in flight on ticket/1-x.\n']);
    expect(s.lock.held()).toBeUndefined();
  });

  it('refuses a family that is not configured, writing nothing', () => {
    const s = setup();
    expect(flowInFlight(['start', 'ticket/1-x', 'codex'], c, s.io)).toBe(1);
    expect(s.out).toEqual(['no family codex in config/flow.json (families: local, cloud)\n']);
    expect(s.fs.writes).toEqual([]);
    expect(s.lock.held()).toBeUndefined();
  });

  it('ends a record, or says it had none', () => {
    const s = setup([flight('ticket/1-x', 'local'), flight('ticket/2-y', 'cloud')]);
    expect(flowInFlight(['end', 'ticket/1-x'], c, s.io)).toBe(0);
    expect(s.recorded()).toEqual([flight('ticket/2-y', 'cloud')]);
    expect(flowInFlight(['end', 'ticket/1-x'], c, s.io)).toBe(0);
    expect(s.out).toEqual(['ticket/1-x is no longer in flight.\n', 'ticket/1-x was not recorded in flight.\n']);
    expect(s.fs.writes).toHaveLength(1);
  });

  it.each([[[]], [['start']], [['start', 'b']], [['start', 'b', 'local', 'x']], [['end', 'b', 'x']], [['end']], [['stop', 'b']]])('prints the usage for %j', (argv) => {
    const s = setup();
    expect(flowInFlight(argv, c, s.io)).toBe(2);
    expect(s.out).toEqual(['usage: flow in-flight start <branch> <family> | end <branch>\n']);
  });

  it('refuses while another run holds the lock', () => {
    const s = setup();
    s.lock.hold(JSON.stringify({ pid: 100, host: 'pc', startedAt: 'x', token: 't' }));
    expect(flowInFlight(['end', 'ticket/1-x'], c, s.io)).toBe(1);
    expect(s.out).toEqual(['the builds in flight are being recorded by another run; try again\n']);
  });
});

describe('a reserved build', () => {
  it('takes a place under the cap and is ended under the lock', () => {
    const s = setup([flight('ticket/1-x', 'local')]);
    reserveBuild('ticket/3-z', 'cloud', [build('2', 'running')], c, s.io);
    expect(s.recorded()).toEqual([flight('ticket/1-x', 'local'), { branch: 'ticket/3-z', family: 'cloud', at: AT }]);
    expect(endBuild('ticket/3-z', c, s.io)).toBe('ticket/3-z is no longer in flight.');
    expect(s.lock.held()).toBeUndefined();
  });

  it('is refused for a branch in flight, at the cap, or for an unknown family', () => {
    const s = setup([flight('ticket/1-x', 'local')]);
    expect(() => reserveBuild('ticket/1-x', 'cloud', [], c, s.io)).toThrow('ticket/1-x is in flight already');
    expect(() => reserveBuild('ticket/2-x', 'cloud', [build('2', 'running')], c, s.io)).toThrow('ticket/2-x is in flight already');
    expect(() => reserveBuild('ticket/4-x', 'cloud', [build('2', 'running'), build('3', 'running')], c, s.io)).toThrow('the build cap of 3 is reached (local 1, unrecorded 2)');
    expect(() => reserveBuild('ticket/4-x', 'gpt', [], c, s.io)).toThrow('no family gpt in config/flow.json');
    expect(s.lock.held()).toBeUndefined();
    expect(s.fs.writes).toEqual([]);
  });
});
