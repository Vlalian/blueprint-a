import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail, fakeCli, memFs, ok, ROOT } from '../test/helpers/flow-fakes.ts';
import { REVIEW_SCHEMA } from '../gates/review-schema/schema.ts';
import { DEFAULTS, type Family } from './config.ts';
import type { RunResult } from './model-run.ts';
import { flowReview, reviewBrief, type ReviewIo } from './review.ts';

const HEAD = 'a'.repeat(40);
const family = (name: string): Family => ({ name, build: `${name} build`, review: `${name} review --prompt {prompt} --out {out}`, timeoutMs: 9 });
const c = { ...DEFAULTS, integrationBranch: 'dev', families: [family('local'), family('cloud')] };
const STATE = join(ROOT, 'state', 'flow');
const DIR = join(STATE, `review-12-${HEAD}`);
const TICKET = '# 12 login\n\n## Result\nBuilder: local\nRound: 2\n';
const finding = { file: 'a.ts', line: 1, severity: 'HIGH', axis: 'spec', claim: 'c', scenario: 's', fix: 'f', ticket: '12', quote: null };

function world(o: { ticket?: string; git?: Record<string, ReturnType<typeof ok>>; files?: Record<string, string>; run?: (command: string) => RunResult; writesOut?: string } = {}) {
  const git = fakeCli({
    'rev-parse origin/ticket/12-login': ok(`${HEAD}\n`),
    [`show ${HEAD}:docs/tickets/12-login.md`]: ok(o.ticket ?? TICKET),
    [`merge-base origin/dev ${HEAD}`]: ok('base0\n'),
    ...o.git,
  });
  const fs = memFs(o.files);
  const shells: unknown[][] = [];
  const said: string[] = [];
  let t = 0;
  const io: ReviewIo = {
    root: ROOT,
    git: git.run,
    ticketFiles: (folder) => (folder === 'docs/tickets' ? ['11-other.md', '12-login.md'] : []),
    ...fs,
    platform: 'linux',
    shell: (command, cwd, input, timeoutMs, env) => {
      shells.push([command, cwd, input, timeoutMs, env]);
      if (o.writesOut !== undefined) fs.write(join(DIR, 'review.json'), o.writesOut);
      return o.run?.(command) ?? { status: 0, stdout: JSON.stringify({ findings: [finding] }), stderr: '' };
    },
    clock: () => (t += 5),
    now: () => 'now',
    out: (s) => void said.push(s),
  };
  return { io, git, fs, shells, said, records: () => (fs.read(join(STATE, 'observations.jsonl')) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

describe('Pass when: a change built by one configured family is reviewed by another configured family', () => {
  it("runs the other family's review command on the exact head, with the brief on stdin", () => {
    const w = world();
    expect(flowReview(['12'], c, w.io)).toBe(0);
    const brief = w.fs.read(join(DIR, 'prompt.md'))!;
    expect(w.shells).toEqual([['cloud review --prompt "$FLOW_PROMPT" --out "$FLOW_OUT"', ROOT, brief, 9, expect.objectContaining({ FLOW_PROMPT: join(DIR, 'prompt.md'), FLOW_OUT: join(DIR, 'review.json') })]]);
    expect(brief).toContain(`Review ticket/12-login at the exact commit ${HEAD}, built by local, against its ticket: standards and spec.\nInspect git diff base0 ${HEAD} and git show ${HEAD}:<path>, not the working tree.\n`);
    expect(brief.slice(brief.indexOf("\nTicket:"))).toBe(`\nTicket:\n${TICKET}`);
    expect(w.git.lines()).toEqual(['fetch origin', 'rev-parse origin/ticket/12-login', `show ${HEAD}:docs/tickets/12-login.md`, `merge-base origin/dev ${HEAD}`]);
    expect(w.said).toEqual([`cloud reviewed ticket/12-login @ aaaaaaa (built by local): ${JSON.stringify({ ok: true, findings: [finding], errors: [] })}\n`]);
    expect(w.fs.json(join(STATE, 'last-review-12.json'))).toEqual({ head: HEAD });
    expect(w.fs.json(join(DIR, 'validated.json'))).toEqual({ ok: true, findings: [finding], errors: [] });
    expect(w.records()).toEqual([
      { at: 'now', run: 'flow', project: '', ticket: '12', role: 'flow-review', kind: 'build-review', builder: 'local', reviewer: 'cloud', round: '2', head: HEAD, ms: 5, exitCode: 0, timedOut: false, findings: [finding], errors: [] },
    ]);
  });

  it("reads the review from {out} when the command writes it there", () => {
    const w = world({ writesOut: '{"findings":[]}', run: () => ({ status: 0, stdout: 'progress', stderr: '' }) });
    expect(flowReview(['12'], c, w.io)).toBe(0);
    expect(w.fs.json(join(DIR, 'validated.json'))).toEqual({ ok: true, findings: [], errors: [] });
  });

  it("refuses the builder's own family and a family that is not configured", () => {
    const own = world();
    expect(flowReview(['12', '--family', 'local'], c, own.io)).toBe(1);
    expect(own.said).toEqual(["refusing a review of local's round by local, its own family\n"]);
    expect(own.shells).toEqual([]);
    const other = world();
    expect(flowReview(['12', '--family', 'third'], c, other.io)).toBe(1);
    expect(other.said).toEqual(['no family third in config/flow.json (families: local, cloud)\n']);
  });

  it('takes a requested family that did not build the round', () => {
    const w = world({ ticket: '## Result\nBuilder: cloud\n' });
    expect(flowReview(['12', '--family', 'local'], c, w.io)).toBe(0);
    expect(w.shells[0]![0]).toMatch(/^local review /);
    expect(w.records()[0]).toMatchObject({ builder: 'cloud', reviewer: 'local', round: '1' });
  });

  it('refuses a round whose Result names no builder', () => {
    const w = world({ ticket: '# 12\n' });
    expect(flowReview(['12'], c, w.io)).toBe(1);
    expect(w.said).toEqual(['the Result of docs/tickets/12-login.md on ticket/12-login names no Builder: <family>\n']);
  });
});

describe('a review', () => {
  it('covers the change since the last reviewed head while the branch holds it', () => {
    const last = { [join(STATE, 'last-review-12.json')]: '{"head":"prev"}' };
    const held = world({ files: last, git: { [`merge-base --is-ancestor prev ${HEAD}`]: ok() } });
    flowReview(['12'], c, held.io);
    expect(held.fs.read(join(DIR, 'prompt.md'))).toContain(`git diff prev ${HEAD}`);
    const gone = world({ files: last, git: { [`merge-base --is-ancestor prev ${HEAD}`]: fail() } });
    flowReview(['12'], c, gone.io);
    expect(gone.fs.read(join(DIR, 'prompt.md'))).toContain(`git diff base0 ${HEAD}`);
  });

  it('is invalid when the reviewer fails or prints no review, and keeps the last reviewed head', () => {
    const w = world({ run: () => ({ status: null, stdout: '', stderr: '', timedOut: true, error: new Error('spawnSync ETIMEDOUT') }) });
    expect(flowReview(['12'], c, w.io)).toBe(1);
    expect(w.fs.json(join(DIR, 'validated.json'))).toEqual({ ok: false, findings: [], errors: ['reviewer crashed: exit code 1'] });
    expect(w.fs.read(join(STATE, 'last-review-12.json'))).toBeUndefined();
    expect(w.records()[0]).toMatchObject({ exitCode: 1, timedOut: true, errors: ['reviewer crashed: exit code 1'] });
  });

  it.each([
    [['12', 'x'], 'usage: flow review <ticket> [--family <name>]'],
    [[], 'usage: flow review <ticket> [--family <name>]'],
    [['13'], 'no ticket 13 in docs/tickets'],
  ])('refuses %j', (argv, says) => {
    const w = world();
    expect(flowReview(argv, c, w.io)).toBe(1);
    expect(w.said).toEqual([`${says}\n`]);
    expect(w.git.calls).toEqual([]);
  });

  it('names the git step that failed', () => {
    const w = world({ git: { 'rev-parse origin/ticket/12-login': { status: 128, stdout: '', stderr: 'unknown revision\n' } } });
    expect(flowReview(['12'], c, w.io)).toBe(1);
    expect(w.said).toEqual(['git rev-parse failed: unknown revision\n']);
    const quiet = world({ git: { fetch: { status: 1, stdout: 'offline\n', stderr: '' } } });
    flowReview(['12'], c, quiet.io);
    expect(quiet.said).toEqual(['git fetch failed: offline\n']);
  });

  it('asks for JSON of the review schema', () => {
    const brief = reviewBrief({ ticket: '1', branch: 'b', head: 'h', text: 't', builder: 'x', reviewer: family('y') }, 'base');
    expect(brief).toContain(`\nReturn only JSON matching this schema: ${JSON.stringify(REVIEW_SCHEMA)}\nTicket:\nt`);
  });
});
