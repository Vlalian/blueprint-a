import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { templated } from '../test/helpers/repo-template.ts';
import { checkVerdict, formatRow, parseLedger, patchIdOf, readVerdict, recordVerdict, runLedger, type LedgerIo, type LedgerRow } from './ledger-core.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const LEDGER = 'state/ledger/sample.tsv';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const P = '1'.repeat(40);
const Q = '2'.repeat(40);

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({ sha: A, patchId: P, verdict: 'VERIFIED', ticket: '01', at: '2026-10-04T00:00:00Z', ...over });

describe('ledger rows', () => {
  it('round-trips a row through one tab-separated line', () => {
    expect(formatRow(row())).toBe(`${A}\t${P}\tVERIFIED\t01\t2026-10-04T00:00:00Z\n`);
    expect(parseLedger(formatRow(row()) + formatRow(row({ sha: B, verdict: 'FAILED' })))).toEqual([row(), row({ sha: B, verdict: 'FAILED' })]);
  });

  it('writes an empty patch-id as "-" and reads it back as empty', () => {
    expect(formatRow(row({ patchId: '' }))).toBe(`${A}\t-\tVERIFIED\t01\t2026-10-04T00:00:00Z\n`);
    expect(parseLedger(formatRow(row({ patchId: '' })))).toEqual([row({ patchId: '' })]);
  });

  it('reads a missing or blank ledger as no rows, skipping blank and CRLF line ends', () => {
    expect(parseLedger(undefined)).toEqual([]);
    expect(parseLedger('\n\n')).toEqual([]);
    expect(parseLedger(formatRow(row()).replace('\n', '\r\n'))).toEqual([row()]);
  });

  it.each([
    ['too few columns', `${A}\t${P}\tVERIFIED\t01\n`],
    ['too many columns', `${A}\t${P}\tVERIFIED\t01\tx\ty\n`],
    ['a verdict outside the enum', `${A}\t${P}\tOK\t01\tx\n`],
    ['NOT-VERIFIED, which is never recorded', `${A}\t${P}\tNOT-VERIFIED\t01\tx\n`],
    ['a short SHA', `abc\t${P}\tVERIFIED\t01\tx\n`],
    ['an upper-case SHA', `${A.toUpperCase()}\t${P}\tVERIFIED\t01\tx\n`],
    ['a SHA with a prefix', `x${A}\t${P}\tVERIFIED\t01\tx\n`],
    ['a SHA with a suffix', `${A}x\t${P}\tVERIFIED\t01\tx\n`],
    ['a bad patch-id', `${A}\tzz\tVERIFIED\t01\tx\n`],
    ['a patch-id with a suffix', `${A}\t${P}0\tVERIFIED\t01\tx\n`],
  ])('refuses a ledger with %s, naming the line', (_label, text) => {
    expect(() => parseLedger(`\n${text}`)).toThrow(/ledger line 2/);
  });

  it('refuses to format a row whose ticket would break the line', () => {
    expect(() => formatRow(row({ ticket: 'a\tb' }))).toThrow(/ticket/);
    expect(() => formatRow(row({ ticket: 'a\nb' }))).toThrow(/ticket/);
    expect(() => formatRow(row({ ticket: '' }))).toThrow(/ticket/);
  });
});

describe('readVerdict', () => {
  it('reads NOT-VERIFIED for a SHA the ledger has never seen', () => {
    expect(readVerdict([], A, P)).toEqual({ sha: A, patchId: P, verdict: 'NOT-VERIFIED', source: 'none' });
    expect(readVerdict([row({ sha: B, patchId: Q })], A, P).verdict).toBe('NOT-VERIFIED');
  });

  it('reads the latest verdict recorded for that exact SHA', () => {
    const rows = [row(), row({ verdict: 'FAILED' })];
    expect(readVerdict(rows, A, P)).toEqual({ sha: A, patchId: P, verdict: 'FAILED', source: 'sha', ticket: '01' });
  });

  it('prefers the exact SHA over a patch-id match', () => {
    const rows = [row({ sha: A, patchId: Q, verdict: 'FAILED' }), row({ sha: B, patchId: P, verdict: 'VERIFIED' })];
    expect(readVerdict(rows, A, P).verdict).toBe('FAILED');
  });

  it('carries a verdict over to a new SHA only when the patch-id matches, naming where it came from', () => {
    const rows = [row({ sha: B, patchId: P, verdict: 'VERIFIED', ticket: '07' })];
    expect(readVerdict(rows, A, P)).toEqual({ sha: A, patchId: P, verdict: 'VERIFIED', source: 'patch-id', carriedFrom: B, ticket: '07' });
    expect(readVerdict(rows, A, Q).verdict).toBe('NOT-VERIFIED');
  });

  it('carries the latest of several patch-id matches', () => {
    const rows = [row({ sha: B, verdict: 'VERIFIED' }), row({ sha: 'c'.repeat(40), verdict: 'FAILED' })];
    expect(readVerdict(rows, A, P)).toMatchObject({ verdict: 'FAILED', carriedFrom: 'c'.repeat(40) });
  });

  it('never carries over an empty patch-id: an empty diff proves nothing', () => {
    expect(readVerdict([row({ sha: B, patchId: '' })], A, '').verdict).toBe('NOT-VERIFIED');
  });
});

describe('patchIdOf', () => {
  it('takes the patch-id, the first word of git patch-id output', () => {
    expect(patchIdOf(`${P} ${'0'.repeat(40)}\n`)).toBe(P);
  });

  it('is empty when git patch-id printed nothing (an empty diff)', () => {
    expect(patchIdOf('')).toBe('');
    expect(patchIdOf('\n')).toBe('');
  });
});

const gitIn = (dir: string) => (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();

/** A real repo: main with one commit, and a feature branch with one change on top; built once, copied per test. */
const freshRepo = templated('ledger-', (dir) => {
  const g = gitIn(dir);
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('checkout', '-qb', 'feature');
  writeFileSync(join(dir, 'a.txt'), 'a\nfeature\n');
  g('commit', '-qam', 'feature');
});

function repo() {
  const dir = freshRepo();
  return { dir, g: gitIn(dir) };
}

function ioFor(dir: string, text: { ledger?: string } = {}): LedgerIo & { written: string[] } {
  const written: string[] = [];
  return {
    git: (args, input) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', input }),
    read: (path) => (path === LEDGER ? text.ledger : undefined),
    append: (path, line) => {
      expect(path).toBe(LEDGER);
      written.push(line);
      text.ledger = (text.ledger ?? '') + line;
    },
    now: () => '2026-10-04T12:00:00Z',
    written,
  };
}

describe('recordVerdict and checkVerdict against a real repo', () => {
  it('records the exact SHA and its patch-id, and reads it back VERIFIED', () => {
    const { dir, g } = repo();
    const io = ioFor(dir);
    const recorded = recordVerdict({ ledger: LEDGER, ref: 'feature', base: 'main', verdict: 'VERIFIED', ticket: '01' }, io);
    expect(recorded.sha).toBe(g('rev-parse', 'feature'));
    expect(recorded.patchId).toMatch(/^[0-9a-f]{40}$/);
    expect(recorded.at).toBe('2026-10-04T12:00:00Z');
    expect(io.written).toEqual([formatRow(recorded)]);
    expect(checkVerdict({ ledger: LEDGER, ref: 'feature', base: 'main' }, io)).toMatchObject({ verdict: 'VERIFIED', source: 'sha' });
  });

  it('reads a new commit on the branch as NOT-VERIFIED', () => {
    const { dir, g } = repo();
    const io = ioFor(dir);
    recordVerdict({ ledger: LEDGER, ref: 'feature', base: 'main', verdict: 'VERIFIED', ticket: '01' }, io);
    writeFileSync(join(dir, 'a.txt'), 'a\nfeature\nmore\n');
    g('commit', '-qam', 'more');
    expect(checkVerdict({ ledger: LEDGER, ref: 'feature', base: 'main' }, io)).toMatchObject({ verdict: 'NOT-VERIFIED', source: 'none' });
  });

  it('keeps the verdict across a rebase that leaves the patch unchanged', () => {
    const { dir, g } = repo();
    const io = ioFor(dir);
    const before = recordVerdict({ ledger: LEDGER, ref: 'feature', base: 'main', verdict: 'VERIFIED', ticket: '01' }, io);
    g('checkout', '-q', 'main');
    writeFileSync(join(dir, 'b.txt'), 'b\nmain moved\n');
    g('commit', '-qam', 'main moves');
    g('checkout', '-q', 'feature');
    g('rebase', '-q', 'main');
    const after = checkVerdict({ ledger: LEDGER, ref: 'feature', base: 'main' }, io);
    expect(after.sha).not.toBe(before.sha);
    expect(after).toMatchObject({ verdict: 'VERIFIED', source: 'patch-id', carriedFrom: before.sha, patchId: before.patchId });
  });

  it('drops the verdict across a rebase that changes the patch', () => {
    const { dir, g } = repo();
    const io = ioFor(dir);
    recordVerdict({ ledger: LEDGER, ref: 'feature', base: 'main', verdict: 'VERIFIED', ticket: '01' }, io);
    g('checkout', '-q', 'main');
    writeFileSync(join(dir, 'a.txt'), 'a\nmain\n');
    g('commit', '-qam', 'main conflicts');
    // The rebase resolved the conflict, so the change it carries is a different patch.
    g('checkout', '-q', '-B', 'feature', 'main');
    writeFileSync(join(dir, 'a.txt'), 'a\nmain\nfeature\n');
    g('commit', '-qam', 'feature, rebased by hand');
    expect(checkVerdict({ ledger: LEDGER, ref: 'feature', base: 'main' }, io).verdict).toBe('NOT-VERIFIED');
  });

  it("reads the same patch-id whatever the user's diff config (colour, an external diff tool)", () => {
    const { dir, g } = repo();
    const plain = checkVerdict({ ledger: LEDGER, ref: 'feature', base: 'main' }, ioFor(dir)).patchId;
    g('config', 'color.ui', 'always');
    g('config', 'diff.external', 'git-no-such-diff-tool');
    expect(checkVerdict({ ledger: LEDGER, ref: 'feature', base: 'main' }, ioFor(dir)).patchId).toBe(plain);
  });

  it("uses git's stable patch-id, which does not depend on the order files appear in the diff", () => {
    const { dir, g } = repo();
    writeFileSync(join(dir, 'b.txt'), 'b\nfeature\n');
    g('commit', '-qam', 'second file');
    const diff = g('diff', 'main', 'feature');
    const stable = execFileSync('git', ['patch-id', '--stable'], { cwd: dir, input: `${diff}\n`, encoding: 'utf8' });
    expect(checkVerdict({ ledger: LEDGER, ref: 'feature', base: 'main' }, ioFor(dir)).patchId).toBe(patchIdOf(stable));
  });

  it('refuses to record NOT-VERIFIED or a verdict outside the enum', () => {
    const { dir } = repo();
    const io = ioFor(dir);
    expect(() => recordVerdict({ ledger: LEDGER, ref: 'feature', base: 'main', verdict: 'NOT-VERIFIED', ticket: '01' }, io)).toThrow(/VERIFIED or FAILED/);
    expect(() => recordVerdict({ ledger: LEDGER, ref: 'feature', base: 'main', verdict: 'ok', ticket: '01' }, io)).toThrow(/VERIFIED or FAILED/);
    expect(io.written).toEqual([]);
  });

  it('throws on a ref that does not name a commit', () => {
    const { dir } = repo();
    expect(() => checkVerdict({ ledger: LEDGER, ref: 'nope', base: 'main' }, ioFor(dir))).toThrow();
  });
});

describe('runLedger (the CLI core)', () => {
  const at = (ref: string) => ['--ledger', LEDGER, '--sha', ref, '--base', 'main'];

  it('records with exit 0 and prints the row', () => {
    const { dir } = repo();
    const r = runLedger(['record', ...at('feature'), '--verdict', 'VERIFIED', '--ticket', '01', '--cwd', 'repo'], (cwd) => (expect(cwd).toBe('repo'), ioFor(dir)));
    expect(r.exitCode).toBe(0);
    expect(r.json).toMatchObject({ recorded: { verdict: 'VERIFIED', ticket: '01' } });
  });

  it('checks with exit 0 VERIFIED, 1 FAILED, 3 NOT-VERIFIED', () => {
    const { dir } = repo();
    const io = ioFor(dir);
    expect(runLedger(['check', ...at('feature')], () => io)).toMatchObject({ exitCode: 3, json: { verdict: 'NOT-VERIFIED' } });
    runLedger(['record', ...at('feature'), '--verdict', 'FAILED', '--ticket', '01'], () => io);
    expect(runLedger(['check', ...at('feature')], () => io)).toMatchObject({ exitCode: 1, json: { verdict: 'FAILED' } });
    runLedger(['record', ...at('feature'), '--verdict', 'VERIFIED', '--ticket', '01'], () => io);
    expect(runLedger(['check', ...at('feature')], () => io)).toMatchObject({ exitCode: 0, json: { verdict: 'VERIFIED' } });
  });

  it.each([
    ['no command', [], /usage/],
    ['an unknown command', ['drop', ...at('feature')], /usage/],
    ['an unknown option', ['check', ...at('feature'), '--bogus'], /bogus/],
    ['no --ledger', ['check', '--sha', 'feature', '--base', 'main'], /--ledger/],
    ['no --sha', ['check', '--ledger', LEDGER, '--base', 'main'], /--sha/],
    ['no --base', ['check', '--ledger', LEDGER, '--sha', 'feature'], /--base/],
    ['record without --ticket', ['record', ...at('feature'), '--verdict', 'VERIFIED'], /--ticket/],
    ['record without --verdict', ['record', ...at('feature'), '--ticket', '01'], /--verdict/],
  ])('exits 2 with an error and no write on %s', (_label, argv, error) => {
    const { dir } = repo();
    const io = ioFor(dir);
    const r = runLedger(argv, () => io);
    expect(r.exitCode).toBe(2);
    expect(r.json.error).toMatch(error);
    expect(io.written).toEqual([]);
  });

  it('runs in the current folder when no --cwd is given', () => {
    const { dir } = repo();
    const seen: string[] = [];
    runLedger(['check', ...at('feature')], (cwd) => (seen.push(cwd), ioFor(dir)));
    expect(seen).toEqual(['.']);
  });

  it('exits 2 when git fails, never reading as a verdict', () => {
    const { dir } = repo();
    const r = runLedger(['check', ...at('nope')], () => ioFor(dir));
    expect(r.exitCode).toBe(2);
    expect(r.json.error).toMatch(/nope/);
  });
});
