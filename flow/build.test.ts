import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail, fakeCli, memFs, memLock, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import { buildBrief, flowBuild, withRound, type BuildIo } from './build.ts';
import { DEFAULTS, type Family } from './config.ts';
import type { RunResult } from './model-run.ts';

const family = (name: string): Family => ({ name, build: `${name} run --in {prompt} --cwd {worktree} --branch {branch} --base {base} --ticket {ticket}`, review: 'r', timeoutMs: 7 });
const c = { ...DEFAULTS, integrationBranch: 'dev', families: [family('local'), family('cloud')], checks: ['npm test', 'npm run crap'] };
const WT = join(ROOT, '.worktrees', 'build-12-id');
const TICKET = '# 12 login\n\nBuild the login.\n';
const STATE = join(ROOT, 'state', 'flow');

function world(o: { git?: Parameters<typeof fakeCli>[0]; model?: RunResult; failing?: string; files?: Record<string, string>; flights?: object[] } = {}) {
  const fs = memFs({ [join(ROOT, 'docs', 'tickets', '12-login.md')]: TICKET, [join(WT, 'docs', 'tickets', '12-login.md')]: TICKET, ...(o.flights === undefined ? {} : { [join(STATE, 'in-flight.json')]: JSON.stringify(o.flights) }), ...o.files });
  const git = fakeCli({ 'for-each-ref': ok(''), '-c status.renames=false status --porcelain=v1 -z --untracked-files=all': ok(' M docs/tickets/12-login.md\0?? src/new file.ts\0'), 'rev-parse --verify origin/ticket/12-login^{commit}': ok('h\n'), ...o.git });
  const shells: unknown[][] = [];
  const flying: unknown[] = [];
  const said: string[] = [];
  const lock = memLock();
  let t = 0;
  const io: BuildIo = {
    root: ROOT,
    git: git.run,
    ...fs,
    lock: () => lock,
    platform: 'linux',
    shell: (command, cwd, input, timeoutMs, env) => {
      shells.push([command, cwd, input, timeoutMs, env]);
      if (shells.length === 1) flying.push(fs.json(join(STATE, 'in-flight.json')));
      if (shells.length === 1) return o.model ?? { status: 0, stdout: 'built\n', stderr: '' };
      return { status: command === o.failing ? 1 : 0, stdout: `${command} out\n`, stderr: '' };
    },
    ticketFiles: (folder) => (folder === 'docs/tickets' ? ['12-login.md'] : []),
    id: () => 'id',
    clock: () => (t += 10),
    now: () => 'now',
    out: (s) => void said.push(s),
  };
  const records = () => (fs.read(join(STATE, 'observations.jsonl')) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { io, fs, git, shells, flying, said, lock, records, inWt: () => git.calls.filter((x) => x.cwd === WT).map((x) => x.args.join(' ')) };
}

describe('flow build', () => {
  it("runs the family's build command in its own worktree, then the configured checks, then commits the round with its family and pushes it", () => {
    const w = world();
    expect(flowBuild(['12', '--family', 'cloud', '--round', '2'], c, w.io)).toBe(0);
    const brief = w.fs.read(join(STATE, 'build-12-2.md'))!;
    expect(w.shells).toEqual([
      [
        'cloud run --in "$FLOW_PROMPT" --cwd "$FLOW_WORKTREE" --branch "$FLOW_BRANCH" --base "$FLOW_BASE" --ticket "$FLOW_TICKET"',
        WT,
        brief,
        7,
        { FLOW_PROMPT: join(STATE, 'build-12-2.md'), FLOW_WORKTREE: WT, FLOW_BRANCH: 'ticket/12-login', FLOW_BASE: 'origin/dev', FLOW_TICKET: '12' },
      ],
      ['npm test', WT, '', 7, {}],
      ['npm run crap', WT, '', 7, {}],
    ]);
    expect(w.git.calls.filter((x) => x.cwd === ROOT).map((x) => x.args.join(' '))).toEqual(expect.arrayContaining(['fetch origin', `worktree add --detach ${WT} origin/ticket/12-login`]));
    expect(w.git.lines().filter((l) => l.startsWith('fetch'))).toEqual(['fetch origin', 'fetch origin']);
    expect(w.flying).toEqual([[{ branch: 'ticket/12-login', family: 'cloud', at: 'now' }]]);
    expect(w.inWt()).toEqual(['merge --no-ff -m Merge dev for ticket 12 origin/dev', '-c status.renames=false status --porcelain=v1 -z --untracked-files=all', 'add -- docs/tickets/12-login.md src/new file.ts', 'commit -q -m Build ticket 12, round 2 (cloud)', 'push origin HEAD:refs/heads/ticket/12-login']);
    expect(w.fs.read(join(WT, 'docs', 'tickets', '12-login.md'))).toBe(`${TICKET}\n## Result\n\nBuilder: cloud\n\nRound: 2\n`);
    expect(w.said).toEqual(['built\n', 'npm test out\n', 'npm run crap out\n', `The build worktree stays at ${WT}.\n`]);
    expect(w.records()).toEqual([{ at: 'now', run: 'flow', project: '', ticket: '12', role: 'flow-build', kind: 'build-review', builder: 'cloud', round: '2', ms: 10, exitCode: 0 }]);
    expect(w.fs.read(join(STATE, 'in-flight.json'))).toBe('[]\n');
    expect(w.lock.held()).toBeUndefined();
  });

  it('writes a Result of its own when the worktree has no ticket file', () => {
    const w = world();
    w.fs.store.delete(join(WT, 'docs', 'tickets', '12-login.md'));
    expect(flowBuild(['12', '--family', 'local'], c, w.io)).toBe(0);
    expect(w.fs.read(join(WT, 'docs', 'tickets', '12-login.md'))).toBe('\n## Result\n\nBuilder: local\n\nRound: 1\n');
  });

  it('starts a first round from the integration branch', () => {
    const w = world({ git: { 'rev-parse --verify origin/ticket/12-login^{commit}': fail() } });
    expect(flowBuild(['12', '--family', 'local'], c, w.io)).toBe(0);
    expect(w.git.lines()).toContain(`worktree add --detach ${WT} origin/dev`);
    expect(w.inWt()).toContain('commit -q -m Build ticket 12, round 1 (local)');
  });

  it('pushes nothing when the model fails, times out or a check fails, and records the failure', () => {
    const failed = world({ model: { status: 3, stdout: '', stderr: 'no\n' } });
    expect(flowBuild(['12', '--family', 'cloud'], c, failed.io)).toBe(1);
    expect(failed.said.slice(-2)).toEqual([`The build worktree stays at ${WT}.\n`, 'the cloud build exited 3\n']);
    expect(failed.inWt().some((l) => l.startsWith('push'))).toBe(false);
    expect(failed.records()[0]).toMatchObject({ exitCode: 1, builder: 'cloud' });
    expect(failed.fs.read(join(STATE, 'in-flight.json'))).toBe('[]\n');
    const slow = world({ model: { status: null, stdout: '', stderr: '', timedOut: true } });
    flowBuild(['12', '--family', 'cloud'], c, slow.io);
    expect(slow.said.at(-1)).toBe('the cloud build timed out\n');
    const check = world({ failing: 'npm test' });
    expect(flowBuild(['12', '--family', 'cloud'], c, check.io)).toBe(1);
    expect(check.said.at(-1)).toBe(`the check npm test failed in ${WT}\n`);
    expect(check.shells).toHaveLength(2);
    expect(check.inWt()).toEqual(['merge --no-ff -m Merge dev for ticket 12 origin/dev']);
  });

  it('names the git step that failed', () => {
    const w = world({ git: { 'merge --no-ff': { status: 1, stdout: 'CONFLICT\n', stderr: '' } } });
    expect(flowBuild(['12', '--family', 'cloud'], c, w.io)).toBe(1);
    expect(w.said.at(-1)).toBe('git merge failed: CONFLICT\n');
    expect(w.shells).toEqual([]);
  });

  it('refuses a round over the cap, taking no place and running nothing', () => {
    const flights = [{ branch: 'ticket/1-a', family: 'local', at: 'x' }, { branch: 'ticket/2-b', family: 'local', at: 'x' }, { branch: 'ticket/3-c', family: 'cloud', at: 'x' }];
    const w = world({ flights });
    expect(flowBuild(['12', '--family', 'cloud'], c, w.io)).toBe(1);
    expect(w.said).toEqual(['the build cap of 3 is reached (local 2, cloud 1)\n']);
    expect(w.shells).toEqual([]);
    expect(w.records()).toEqual([]);
  });

  it.each([
    [['12'], 'usage: flow build <ticket> --family <name> [--round <n>] [--prompt <file>]'],
    [['12', '13', '--family', 'local'], 'usage: flow build <ticket> --family <name> [--round <n>] [--prompt <file>]'],
    [['14', '--family', 'local'], 'no ticket 14 in docs/tickets'],
    [['12', '--family', 'codex'], 'no family codex in config/flow.json (families: local, cloud)'],
    [['12', '--family', 'local', '--prompt', 'extra.md'], 'the prompt file extra.md cannot be read'],
  ])('refuses %j', (argv, says) => {
    const w = world();
    expect(flowBuild(argv, c, w.io)).toBe(1);
    expect(w.said).toEqual([`${says}\n`]);
    expect(w.git.calls).toEqual([]);
  });
});

describe('the build brief', () => {
  it('asks for the checks before handover and the CRAP and mutation numbers, then gives the ticket and the extra prompt', () => {
    const fs = memFs({ [join(ROOT, 'docs', 'tickets', '12-login.md')]: TICKET, 'extra.md': 'Fix the review findings.' });
    expect(buildBrief({ ticket: '12', name: '12-login', family: 'local', round: '3', prompt: 'extra.md' }, c, { root: ROOT, read: fs.read })).toBe(
      [
        'Build ticket 12, round 3, as the local family.',
        'Only edit files. Never git add, commit, merge, checkout or push: the flow owns git.',
        'Test-first, one Pass-when line at a time.',
        'Before handing over, run every check and fix what fails: npm test; npm run crap.',
        'Then state the highest CRAP score and the mutants killed of total for the head in the Result; where the mutation tool cannot run, say so and give CRAP from a coverage file.',
        TICKET,
        'Fix the review findings.',
      ].join('\n'),
    );
    expect(buildBrief({ ticket: '12', name: '12-login', family: 'local', round: '1' }, c, { root: ROOT, read: fs.read }).endsWith(`\n${TICKET}\n`)).toBe(true);
    expect(() => buildBrief({ ticket: '13', name: '13-x', family: 'local', round: '1' }, c, { root: ROOT, read: fs.read })).toThrow('docs/tickets/13-x.md cannot be read');
  });
});

describe("a round's Result", () => {
  it('gets a heading when it has none, the family unless the last Builder names it, and the round', () => {
    expect(withRound('# 1\n', 'local', '1')).toBe('# 1\n\n## Result\n\nBuilder: local\n\nRound: 1\n');
    expect(withRound('# 1\n## Result\nBuilder: local\n', 'local', '2')).toBe('# 1\n## Result\nBuilder: local\n\nRound: 2\n');
    expect(withRound('# 1\n## Result\nBuilder: cloud\n', 'local', '2')).toBe('# 1\n## Result\nBuilder: cloud\n\nBuilder: local\n\nRound: 2\n');
  });
});
