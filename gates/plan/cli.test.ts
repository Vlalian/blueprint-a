import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GOOD_CLAIMS } from '../research/fixtures.ts';
import { GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'cli.ts');

describe('plan CLI', () => {
  it('exits 2 with a JSON error, not 1, on an unknown option', () => {
    const r = spawnSync(process.execPath, [CLI, '--bogus'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'plan', pass: false, error: expect.stringContaining('--bogus') });
  });

  it('exits 2 when the plan file cannot be read', () => {
    const r = spawnSync(process.execPath, [CLI, '--plan', 'no/such/plan.md', '--ticket', 'no/such/ticket.md'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });

  it("looks the plan's claim IDs up in the ticket's research folder when given one (ticket 35)", () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-cli-'));
    const repo = join(dir, 'repo');
    const research = join(dir, 'state', 'research', 'sample', '01');
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(research, { recursive: true });
    writeFileSync(join(repo, 'src', 'is-even.ts'), '');
    writeFileSync(join(research, '2026-10-04-03-count-words.md'), GOOD_CLAIMS);
    writeFileSync(join(dir, 'plan.md'), GOOD_PLAN.replace('## Out of scope\n', '## Out of scope\nThe API returns null (2026-10-04-03-count-words#C3, 2026-10-04-03-count-words#C9).\n'));
    writeFileSync(join(dir, 'ticket.md'), GOOD_TICKET);
    const args = ['--plan', join(dir, 'plan.md'), '--ticket', join(dir, 'ticket.md'), '--repo', repo];
    const r = spawnSync(process.execPath, [CLI, ...args, '--research', research], { encoding: 'utf8' });
    expect(r.status, r.stdout).toBe(1);
    expect(JSON.parse(r.stdout).checks.facts).toEqual([{ message: '2026-10-04-03-count-words#C9 cites a claim 2026-10-04-03-count-words.md does not hold' }]);
    expect(spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }).status).toBe(0);
    const elsewhere = spawnSync(process.execPath, [CLI, ...args, '--research', join(dir, 'state', 'research', 'sample', '02')], { encoding: 'utf8' });
    expect(JSON.parse(elsewhere.stdout).checks.facts).toHaveLength(2);
  });

  it('does not count a cited file that a symlink in the repo takes outside it (#46)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-cli-'));
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(dir, 'outside'));
    writeFileSync(join(repo, 'src', 'is-even.ts'), '');
    writeFileSync(join(dir, 'outside', 'notes.md'), '');
    // A junction needs no privileges on Windows; elsewhere the type is ignored.
    symlinkSync(join(dir, 'outside'), join(repo, 'link'), 'junction');
    writeFileSync(join(dir, 'plan.md'), GOOD_PLAN.replace('`src/is-even.ts:1` shows', '`link/notes.md` and `src/is-even.ts:1` show'));
    writeFileSync(join(dir, 'ticket.md'), GOOD_TICKET);
    const r = spawnSync(process.execPath, [CLI, '--plan', join(dir, 'plan.md'), '--ticket', join(dir, 'ticket.md'), '--repo', repo], { encoding: 'utf8' });
    expect(r.status, r.stdout).toBe(1);
    expect(JSON.parse(r.stdout).checks['cross-artifact']).toEqual([{ message: 'cited file does not exist: link/notes.md' }]);
  });
});
