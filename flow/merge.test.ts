import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail, fakeCli, memFs, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import { DEFAULTS, type Family } from './config.ts';
import type { GateResult } from './gate-queue-state.ts';
import { flowMerge, RUN_TIME, uncleanLines, type Consent, type MergeIo, type ReviewVerdict } from './merge.ts';

const family = (name: string): Family => ({ name, build: 'b', review: 'r', timeoutMs: 1 });
const c = { ...DEFAULTS, integrationBranch: 'dev', owner: 'Ana', families: [family('local'), family('cloud')], afterMerge: { commands: ['make registry', 'make relock'], add: ['registry.json', 'locks.lock'] } };
const WT = join(ROOT, '.worktrees', 'integration');
const QUEUE = join(ROOT, 'state', 'flow', 'gate-queue.json');
const CONSENTS = join(ROOT, 'state', 'flow', 'consents.json');
const REVIEWS = join(ROOT, 'state', 'flow', 'reviews.json');
const FINDINGS = join(ROOT, 'review-71.json');
const HEAD = 'h71aaaaaaaa';
const GATED = 'b1aaaaaaaaa';
const AT = '2026-10-21T20:00:00.000Z';
const SHOW = `show ${HEAD}:docs/tickets/71-a.md`;

const result = (o: Partial<GateResult> = {}): GateResult => ({ ticket: '71', branch: 'ticket/71-a', head: HEAD, base: GATED, status: 'green', log: 'l', at: 'a', ...o });
const yes = (o: Partial<Consent> = {}): Record<string, Consent> => ({ '71': { words: 'yes, merge 71', head: HEAD, branch: 'ticket/71-a', at: 'then', ...o } });
const FIXED = [{ finding: 'stale base', outcome: 'fixed' }, { finding: 'a nit', outcome: 'declined', reason: 'out of scope' }];
const reviewed = (o: Partial<ReviewVerdict> = {}): Record<string, ReviewVerdict> => ({ '71': { reviewer: 'cloud', head: HEAD, branch: 'ticket/71-a', at: 'then', findings: FIXED, ...o } });

function setup(o: { results?: GateResult[]; consents?: Record<string, Consent>; reviews?: Record<string, ReviewVerdict> | null; git?: Parameters<typeof fakeCli>[0]; shell?: (command: string) => number } = {}) {
  const reviews = o.reviews === null ? {} : { [REVIEWS]: JSON.stringify(o.reviews ?? reviewed()) };
  const fs = memFs({ [QUEUE]: JSON.stringify({ queue: [], results: o.results ?? [result()] }), ...reviews, ...(o.consents === undefined ? {} : { [CONSENTS]: JSON.stringify(o.consents) }) });
  const git = fakeCli({
    'rev-parse --verify origin/ticket/71-a^{commit}': ok(`${HEAD}\n`),
    [SHOW]: ok('# 71\n## Result\nBuilder: local\n'),
    'rev-parse --abbrev-ref HEAD': ok('dev\n'),
    'status --porcelain': ok('?? state/x.json\n?? .worktrees/\n'),
    'rev-parse HEAD': ok('m1234567890\n'),
    'rev-parse --verify HEAD^{commit}': ok(`${GATED}\n`),
    ...o.git,
  });
  const shells: string[][] = [];
  const out: string[] = [];
  const io: MergeIo = {
    root: ROOT,
    ...fs,
    git: git.run,
    run: (command, cwd) => (shells.push([command, cwd]), (o.shell ?? (() => 0))(command)),
    worktreeId: () => 'run',
    now: () => AT,
    out: (t) => void out.push(t),
  };
  return { io, fs, git, out, shells, consents: () => fs.json(CONSENTS) as Record<string, Consent>, reviews: () => fs.json(REVIEWS) as Record<string, ReviewVerdict>, inWt: () => git.calls.filter((x) => x.cwd === WT).map((x) => x.args.join(' ')) };
}

const merge = (s: ReturnType<typeof setup>, argv = ['71']) => flowMerge(argv, c, s.io);

describe('the other-family rule at the merge (11-optimisations item 5)', () => {
  it('refuses a round reviewed only by the family that built it', () => {
    const s = setup({ consents: yes(), reviews: reviewed({ reviewer: 'local' }) });
    expect(merge(s)).toBe(1);
    expect(s.out).toEqual(['Refused: no review by the other family: the round local built was reviewed by local only\n']);
    expect(s.inWt()).toEqual([]);
  });

  it('reads the builder from the last Result of the ticket at the head', () => {
    const s = setup({ consents: yes(), reviews: reviewed({ reviewer: 'local' }), git: { [SHOW]: ok('Builder: local\n## Result\nBuilder: cloud\n') } });
    expect(merge(s)).toBe(0);
  });

  it('refuses a round whose Result names no builder', () => {
    const s = setup({ consents: yes(), git: { [SHOW]: ok('# 71\n') } });
    expect(merge(s)).toBe(1);
    expect(s.out).toEqual(['Refused: the Result of docs/tickets/71-a.md at h71aaaa names no Builder: <family>, so no other family can be told\n']);
  });
});

describe('the untracked run-time files', () => {
  it('leave the integration worktree clean, the configured state and worktree folders too', () => {
    expect(RUN_TIME).toEqual(['state/', '.worktrees/', '.stryker-tmp/', 'reports/']);
    const porcelain = '?? state/a\r\n M src/x.ts\n?? ".worktrees/a b"\n?? reports/r.json\n?? .stryker-tmp/s\n?? var/f\n?? wt/x\n\n M docs/state/x.md\n';
    expect(uncleanLines(porcelain, DEFAULTS)).toEqual([' M src/x.ts', '?? var/f', '?? wt/x', ' M docs/state/x.md']);
    expect(uncleanLines(porcelain, { stateDir: 'var', worktreeDir: 'wt' })).toEqual([' M src/x.ts', ' M docs/state/x.md']);
  });

  it('count a tracked file under a run-time folder as unclean', () => {
    expect(uncleanLines('M  state/x.json\nA  reports/r.json\n?? .worktrees/x\n', DEFAULTS)).toEqual(['M  state/x.json', 'A  reports/r.json']);
  });
});

describe('flow merge --consent', () => {
  it("records the owner's words for the ticket branch's current head", () => {
    const s = setup({ consents: { '70': { words: 'ok', head: 'x', branch: 'b', at: 't' } } });
    expect(merge(s, ['--consent', '71', 'yes, merge 71'])).toBe(0);
    expect(s.consents()).toEqual({ '70': { words: 'ok', head: 'x', branch: 'b', at: 't' }, '71': { words: 'yes, merge 71', head: HEAD, branch: 'ticket/71-a', at: AT } });
    expect(s.out).toEqual([`Recorded Ana's yes for ticket 71 on ticket/71-a @ h71aaaa: "yes, merge 71"\n`]);
    expect(s.git.lines()[0]).toBe('fetch origin');
  });

  it('needs words and a gated ticket', () => {
    const blank = setup();
    expect(merge(blank, ['--consent', '71', ' '])).toBe(1);
    expect(blank.out).toEqual(['Refused: a yes needs Ana\'s words: flow merge --consent <ticket> "<words>"\n']);
    const never = setup({ results: [] });
    expect(merge(never, ['--consent', '71', 'yes'])).toBe(1);
    expect(never.out).toEqual(['Refused: ticket 71 has no result in the gate queue; run flow gate-queue add <branch>, then run\n']);
    expect(never.fs.read(CONSENTS)).toBeUndefined();
  });

  it('refuses when git cannot fetch or find the branch', () => {
    const s = setup({ git: { 'fetch origin': fail('no network') } });
    expect(merge(s, ['--consent', '71', 'yes'])).toBe(1);
    expect(s.out).toEqual(['Refused: git fetch origin failed: no network\n']);
    const gone = setup({ git: { 'rev-parse --verify origin/ticket/71-a^{commit}': { status: 128, stdout: 'fatal\n', stderr: '' } } });
    merge(gone, ['--consent', '71', 'yes']);
    expect(gone.out).toEqual(['Refused: git rev-parse origin/ticket/71-a failed: fatal\n']);
  });

  it('names a consents file it cannot read', () => {
    const s = setup();
    s.fs.store.set(CONSENTS, '{');
    expect(() => merge(s, ['--consent', '71', 'yes'])).toThrow(/^consents\.json could not be read: /);
  });
});

describe('flow merge --review', () => {
  it("records a configured family's review, bound to the branch's current head", () => {
    const s = setup({ reviews: { '70': reviewed()['71']! } });
    s.fs.store.set(FINDINGS, JSON.stringify(FIXED));
    expect(merge(s, ['--review', '71', 'cloud', FINDINGS])).toBe(0);
    expect(s.reviews()).toEqual({ '70': reviewed()['71'], '71': { reviewer: 'cloud', head: HEAD, branch: 'ticket/71-a', at: AT, findings: FIXED } });
    expect(s.out).toEqual(['Recorded the cloud review of ticket 71 on ticket/71-a @ h71aaaa: 2 finding(s), each fixed or declined with a reason\n']);
  });

  it('says how many findings are still open', () => {
    const s = setup({ reviews: null });
    s.fs.store.set(FINDINGS, JSON.stringify([{ finding: 'bug', outcome: 'open' }, { finding: 'nit', outcome: 'declined', reason: ' ' }, FIXED[0]]));
    expect(merge(s, ['--review', '71', 'local', FINDINGS])).toBe(0);
    expect(s.out).toEqual(['Recorded the local review of ticket 71 on ticket/71-a @ h71aaaa: 3 finding(s), 2 not yet fixed or declined with a reason\n']);
  });

  it('refuses a family that is not configured and a findings file that is missing or not a list', () => {
    const unknown = setup({ reviews: null });
    unknown.fs.store.set(FINDINGS, '[]');
    expect(merge(unknown, ['--review', '71', 'codex', FINDINGS])).toBe(1);
    expect(unknown.out).toEqual(['Refused: no family codex in config/flow.json to have reviewed it\n']);
    const missing = setup({ reviews: null });
    expect(merge(missing, ['--review', '71', 'cloud', FINDINGS])).toBe(1);
    expect(missing.out).toEqual([`Refused: ${FINDINGS} must hold the review's findings as a JSON list of {finding, outcome: "fixed" | "declined", reason}\n`]);
    for (const text of ['{', '{}', '[1]', '[null]', '[{}, 1]']) {
      const bad = setup({ reviews: null });
      bad.fs.store.set(FINDINGS, text);
      expect(merge(bad, ['--review', '71', 'cloud', FINDINGS])).toBe(1);
      expect(bad.git.calls).toEqual([]);
      expect(bad.fs.read(REVIEWS)).toBeUndefined();
    }
  });
});

describe('flow merge <ticket>', () => {
  it('merges: the base brought up to date, merged without a commit, the after-merge commands run, committed by path, pushed', () => {
    const s = setup({ consents: yes() });
    expect(merge(s)).toBe(0);
    expect(s.inWt()).toEqual([
      'rev-parse --abbrev-ref HEAD',
      'status --porcelain',
      'merge --ff-only origin/dev',
      'rev-parse --verify HEAD^{commit}',
      `merge --no-ff --no-commit ${HEAD}`,
      'add -- registry.json locks.lock',
      `commit -q -m Merge ticket/71-a into dev (ticket 71)\n\nAna's yes: "yes, merge 71" (then)`,
      'rev-parse HEAD',
      'push origin HEAD:refs/heads/dev',
    ]);
    expect(s.shells).toEqual([
      ['make registry', WT],
      ['make relock', WT],
    ]);
    expect(s.consents()['71']).toEqual({ ...yes()['71'], merged: 'm1234567890' });
    expect(s.out).toEqual(['Merged ticket/71-a @ h71aaaa into dev as m123456 and pushed it.\nNo open ticket branch to merge dev into.\n']);
  });

  it('adds no file when no after-merge file is configured', () => {
    const s = setup({ consents: yes() });
    expect(flowMerge(['71'], { ...c, afterMerge: { commands: [], add: [] } }, s.io)).toBe(0);
    expect(s.inWt().some((l) => l.startsWith('add'))).toBe(false);
    expect(s.shells).toEqual([]);
  });

  it('then merges the base into the open ticket branches and lists each', () => {
    const s = setup({
      consents: yes(),
      git: {
        'for-each-ref': ok('origin/ticket/71-a\norigin/ticket/72-b\n'),
        'merge-base --is-ancestor': fail(''),
        'merge-base --is-ancestor origin/ticket/71-a': ok(),
        'show origin/ticket/72-b:docs/tickets/72-b.md': ok('## Result\n'),
      },
    });
    expect(merge(s)).toBe(0);
    expect(s.out).toEqual(['Merged ticket/71-a @ h71aaaa into dev as m123456 and pushed it.\ndev into the open ticket branches:\n  ticket/72-b: merged and pushed\n']);
    expect(s.shells.at(-1)).toEqual(['npx tsc --noEmit', join(ROOT, '.worktrees', 'base-into-72-run')]);
  });

  it('undoes the merge when an after-merge command fails', () => {
    const s = setup({ consents: yes(), shell: (command) => (command === 'make relock' ? 1 : 0) });
    expect(merge(s)).toBe(1);
    expect(s.out).toEqual(['Refused: the after-merge command make relock failed\n']);
    expect(s.inWt().at(-1)).toBe('merge --abort');
    expect(s.inWt().some((l) => l.startsWith('commit') || l.startsWith('push'))).toBe(false);
  });

  it('refuses without a recorded yes, and a yes used already', () => {
    const none = setup();
    expect(merge(none)).toBe(1);
    expect(none.out).toEqual(['Refused: no recorded yes from Ana for ticket 71; record it with flow merge --consent 71 "<words>"\n']);
    expect(none.git.calls).toEqual([]);
    const used = setup({ consents: yes({ merged: 'm1234567890' }) });
    expect(merge(used)).toBe(1);
    expect(used.out).toEqual(["Refused: Ana's yes for ticket 71 was used already: merged in m123456\n"]);
  });

  it('refuses when the yes was given on another head', () => {
    const s = setup({ consents: yes({ head: 'oldhead999' }) });
    expect(merge(s)).toBe(1);
    expect(s.out).toEqual(["Refused: Ana's yes for ticket 71 was given on oldhead, but ticket/71-a is now at h71aaaa; ask again\n"]);
  });

  it('refuses when the gate ran on another head, or was not green', () => {
    const moved = setup({ consents: yes(), results: [result({ head: 'gatedhead1' })] });
    expect(merge(moved)).toBe(1);
    expect(moved.out).toEqual(['Refused: the gate ran on gatedhe, but ticket/71-a is now at h71aaaa; gate it again\n']);
    const red = setup({ consents: yes(), results: [result(), result({ status: 'red', stage: 'gate 2' })] });
    merge(red);
    expect(red.out).toEqual(['Refused: the gate on h71aaaa is red at gate 2, not green\n']);
    const conflict = setup({ consents: yes(), results: [result({ status: 'conflict' })] });
    merge(conflict);
    expect(conflict.out).toEqual(['Refused: the gate on h71aaaa is conflict, not green\n']);
  });

  it('refuses when the base moved since the gate', () => {
    const s = setup({ consents: yes(), git: { 'rev-parse --verify HEAD^{commit}': ok('b2bbbbbbbbb\n') } });
    expect(merge(s)).toBe(1);
    expect(s.out).toEqual(['Refused: the gate ran on dev at b1aaaaa, but dev is now at b2bbbbb; gate it again\n']);
    expect(s.consents()['71']!.merged).toBeUndefined();
  });

  it('refuses before a review is recorded, one on another head, or one with open findings', () => {
    const none = setup({ consents: yes(), reviews: null });
    expect(merge(none)).toBe(1);
    expect(none.out).toEqual(['Refused: no review is recorded for ticket 71; have a family other than local review it, settle each finding, and record them with flow merge --review 71 <family> <findings.json>\n']);
    const moved = setup({ consents: yes(), reviews: reviewed({ head: 'oldhead999' }) });
    merge(moved);
    expect(moved.out).toEqual(['Refused: the review of ticket 71 was recorded on oldhead, but ticket/71-a is now at h71aaaa; record it again with flow merge --review 71 <family> <findings.json>\n']);
    const findings = [FIXED[0]!, { finding: 'open bug', outcome: 'open', reason: 'later' }, { finding: 'bare no', outcome: 'declined' }, FIXED[1]!];
    const open = setup({ consents: yes(), reviews: reviewed({ findings }) });
    merge(open);
    expect(open.out).toEqual(['Refused: 2 finding(s) of the cloud review of ticket 71 are neither fixed nor declined with a reason:\n  - open bug\n  - bare no\n']);
    expect(merge(setup({ consents: yes(), reviews: reviewed({ findings: [] }) }))).toBe(0);
  });

  it('refuses an integration worktree that is not on the integration branch or not clean', () => {
    const off = setup({ consents: yes(), git: { 'rev-parse --abbrev-ref HEAD': ok('main\n') } });
    merge(off);
    expect(off.out).toEqual([`Refused: the integration worktree ${WT} is on main, not dev\n`]);
    const dirty = setup({ consents: yes(), git: { 'status --porcelain': ok('?? state/a\n M src/x.ts\n M src/y.ts\n') } });
    merge(dirty);
    expect(dirty.out).toEqual(['Refused: the integration worktree is not clean:\n M src/x.ts\n M src/y.ts\n']);
  });

  it('undoes a merge that conflicts or whose commit fails, and pushes nothing', () => {
    const conflict = setup({ consents: yes(), git: { 'merge --no-ff': fail('CONFLICT (content)') } });
    expect(merge(conflict)).toBe(1);
    expect(conflict.out).toEqual(['Refused: merging ticket/71-a failed: CONFLICT (content)\n']);
    expect(conflict.inWt().at(-1)).toBe('merge --abort');
    const commit = setup({ consents: yes(), git: { commit: fail('nothing') } });
    merge(commit);
    expect(commit.inWt().at(-1)).toBe('merge --abort');
  });

  it.each([
    ['rev-parse --abbrev-ref HEAD', 'git in the integration worktree'],
    ['status --porcelain', 'git status in the integration worktree'],
    ['merge --ff-only', 'bringing dev up to date'],
    ['add -- registry.json locks.lock', 'git add of the after-merge files'],
    ['commit', 'git commit'],
    ['rev-parse HEAD', 'git rev-parse HEAD'],
    ['rev-parse --verify HEAD^{commit}', 'git rev-parse dev'],
    ['push', 'pushing dev (the merge m123456 is committed in the integration worktree)'],
  ])('refuses when `git %s` fails, as %s', (line, what) => {
    const s = setup({ consents: yes(), git: { [line]: fail('broken') } });
    expect(merge(s)).toBe(1);
    expect(s.out).toEqual([`Refused: ${what} failed: broken\n`]);
    expect(s.consents()['71']!.merged).toBeUndefined();
  });

  it('lets an unexpected error through', () => {
    const s = setup({ consents: yes() });
    s.fs.store.set(QUEUE, '{');
    expect(() => merge(s)).toThrow(/gate-queue\.json could not be read/);
  });

  it.each([[[]], [['--consent', '71']], [['--consent', '71', 'yes', 'x']], [['71', 'x']], [['--force']], [['--force', '71']], [['--review', '71', 'cloud']], [['--review', '71', 'cloud', 'f', 'x']], [['--consent']]])('shows the usage for %j', (argv) => {
    const s = setup();
    expect(merge(s, argv)).toBe(2);
    expect(s.out).toEqual(['usage: flow merge <ticket> | --consent <ticket> "<words>" | --review <ticket> <family> <findings.json>\n']);
  });
});
