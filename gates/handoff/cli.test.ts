import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'a');
  g('add', '-A');
  g('commit', '-qm', 'a');
  return { dir, sha: g('rev-parse', 'HEAD') };
}

const env = { ...process.env, WORKFLOW_ROLE: 'coder', WORKFLOW_ROLES: 'coder,cleaner' };

describe('handoff CLI', () => {
  it('writes the canonical handoff into the outbox for a valid draft, with the full SHA', () => {
    const { dir, sha } = repo();
    const draft = join(dir, 'draft.txt');
    writeFileSync(draft, `type: git_handoff\nto: cleaner\npriority: 50\ntask: add-slugify\ncommit: ${sha.slice(0, 10)}\n`);
    const outbox = join(dir, 'outbox');
    const r = spawnSync(process.execPath, [CLI, '--draft', draft, '--outbox', outbox, '--cwd', dir], { env, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const [file] = readdirSync(outbox).filter((f) => f.endsWith('.handoff'));
    expect(readFileSync(join(outbox, file!), 'utf8')).toContain(`commit: ${sha}`);
    expect(readdirSync(join(outbox, 'tmp'))).toEqual([]);
  });

  it('refuses a draft naming a commit that does not exist, writing nothing', () => {
    const { dir } = repo();
    const draft = join(dir, 'draft.txt');
    writeFileSync(draft, 'type: git_handoff\nto: cleaner\npriority: 50\ntask: x\ncommit: 0123456789\n');
    const outbox = join(dir, 'outbox');
    const r = spawnSync(process.execPath, [CLI, '--draft', draft, '--outbox', outbox, '--cwd', dir], { env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).errors).toEqual(['commit "0123456789" does not resolve to a commit']);
    expect(existsSync(outbox) ? readdirSync(outbox).filter((f) => f.endsWith('.handoff')) : []).toEqual([]);
  });

  it('exits 2 with a JSON error, not 1, on an unknown option or an outbox it cannot create', () => {
    const { dir } = repo();
    const bogus = spawnSync(process.execPath, [CLI, '--bogus'], { env, encoding: 'utf8' });
    expect(bogus.status).toBe(2);
    expect(JSON.parse(bogus.stdout)).toMatchObject({ gate: 'handoff', pass: false, error: expect.stringContaining('--bogus') });
    const draft = join(dir, 'draft.txt');
    writeFileSync(draft, 'type: note\n');
    const r = spawnSync(process.execPath, [CLI, '--draft', draft, '--outbox', join(dir, 'a.txt')], { env, encoding: 'utf8' });
    expect(r.status).toBe(2);
  });

  it('exits 2 when the outbox sequence file is not a count', () => {
    const { dir, sha } = repo();
    const draft = join(dir, 'draft.txt');
    writeFileSync(draft, `type: git_handoff\nto: cleaner\npriority: 50\ntask: add-slugify\ncommit: ${sha}\n`);
    const outbox = join(dir, 'outbox');
    mkdirSync(outbox);
    writeFileSync(join(outbox, '.sequence'), 'garbage');
    const r = spawnSync(process.execPath, [CLI, '--draft', draft, '--outbox', outbox, '--cwd', dir], { env, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(readdirSync(outbox).filter((f) => f.endsWith('.handoff'))).toEqual([]);
  });

  it('exits 2, not 1, when --cwd is not a git repo: the draft is not at fault (review #23)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'handoff-norepo-'));
    const draft = join(dir, 'draft.txt');
    writeFileSync(draft, 'type: git_handoff\nto: cleaner\npriority: 50\ntask: x\ncommit: 0123456789\n');
    const r = spawnSync(process.execPath, [CLI, '--draft', draft, '--outbox', join(dir, 'outbox'), '--cwd', dir], { env, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toContain('not a git repository');
  });

  it('does not reuse a sequence number another writer claimed but has not recorded yet (review #24)', () => {
    const { dir, sha } = repo();
    const draft = join(dir, 'draft.txt');
    writeFileSync(draft, `type: git_handoff\nto: cleaner\npriority: 50\ntask: add-slugify\ncommit: ${sha}\n`);
    const outbox = join(dir, 'outbox');
    // A second handoff read .sequence (absent) at the same moment, and holds number 1.
    mkdirSync(join(outbox, '.claimed'), { recursive: true });
    writeFileSync(join(outbox, '.claimed', '1'), '');
    const r = spawnSync(process.execPath, [CLI, '--draft', draft, '--outbox', outbox, '--cwd', dir], { env, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).file).toMatch(/_000002_from_coder_to_cleaner\.handoff$/);
    expect(readFileSync(join(outbox, '.sequence'), 'utf8')).toBe('2');
  });

  it('never overwrites a handoff already in the outbox: it exits 2 and leaves the file alone (review #24)', () => {
    const { dir, sha } = repo();
    const draft = join(dir, 'draft.txt');
    writeFileSync(draft, `type: git_handoff\nto: cleaner\npriority: 50\ntask: add-slugify\ncommit: ${sha}\n`);
    const outbox = join(dir, 'outbox');
    mkdirSync(outbox);
    // The names sequence 1 would get in the next minute, already taken (the claims were lost). A minute,
    // not a few seconds: under a full-suite load on Windows the CLI took over 4 s to start.
    const names = Array.from({ length: 60 }, (_, s) => s).map((s) => {
      const stamp = new Date(Date.now() + s * 1000).toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
      return `50_${stamp}_000001_from_coder_to_cleaner.handoff`;
    });
    for (const name of names) writeFileSync(join(outbox, name), 'earlier');
    const r = spawnSync(process.execPath, [CLI, '--draft', draft, '--outbox', outbox, '--cwd', dir], { env, encoding: 'utf8' });
    expect(r.status).toBe(2);
    for (const name of names) expect(readFileSync(join(outbox, name), 'utf8')).toBe('earlier');
    expect(readdirSync(join(outbox, 'tmp'))).toEqual([]);
  });

  it('exits 2 without --draft and --outbox', () => {
    expect(spawnSync(process.execPath, [CLI], { env }).status).toBe(2);
  });
});
