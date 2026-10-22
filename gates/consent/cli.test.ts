import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const ROOT = resolve(import.meta.dirname, '../..');
const AGREED = '# 9 x\n\nStatus: ready-for-agent\nAgreed: 2026-10-07 (Ada: "build it")\n';

/** A repo with the gate as it travels (gates/consent, gates/locks, gates/lib), its consent config and a first commit. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'consent-cli-'));
  mkdirSync(join(dir, 'gates', 'lib'), { recursive: true });
  for (const gate of ['consent', 'locks']) cpSync(join(ROOT, 'gates', gate), join(dir, 'gates', gate), { recursive: true });
  for (const f of ['contract.ts', 'glob.ts']) cpSync(join(ROOT, 'gates', 'lib', f), join(dir, 'gates', 'lib', f));
  mkdirSync(join(dir, 'config'));
  mkdirSync(join(dir, 'work', 'tickets'), { recursive: true });
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'config', 'consent.json'), '{"owner":"Ada","tickets":"work/tickets"}');
  writeFileSync(join(dir, 'src', 'a.ts'), 'a');
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@localhost', ...args], { cwd: dir, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  };
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const cli = (...args: string[]) => {
    const r = spawnSync(process.execPath, [join(dir, 'gates', 'consent', 'cli.ts'), ...args], { cwd: dir, encoding: 'utf8' });
    return { status: r.status, json: JSON.parse(r.stdout || '{}'), stderr: r.stderr };
  };
  return { dir, git, cli };
}

it('refuses a staged change to a default-locked path on main, and passes it on an agreed ticket branch', () => {
  const r = repo();
  writeFileSync(join(r.dir, 'package.json'), '{"type":"module","x":1}');
  r.git('add', 'package.json');
  expect(r.cli('--staged')).toMatchObject({ status: 1, json: { gate: 'consent', pass: false, branch: 'main', locked: ['package.json'], agreed: false } });
  writeFileSync(join(r.dir, 'work', 'tickets', '9-x.md'), AGREED);
  r.git('add', join('work', 'tickets', '9-x.md'));
  r.git('checkout', '-q', '-b', 'ticket/9-x');
  expect(r.cli('--staged')).toMatchObject({ status: 0, json: { pass: true, locked: ['package.json'], agreed: true, tickets: [] } });
});

it('reads the working tree against --base, untracked files included, and a buildable ticket without the owner refuses', () => {
  const r = repo();
  writeFileSync(join(r.dir, 'src', 'a.ts'), 'b');
  expect(r.cli('--base', 'HEAD')).toMatchObject({ status: 0, json: { pass: true, locked: [], tickets: [] } });
  writeFileSync(join(r.dir, 'work', 'tickets', '10-y.md'), '# 10 y\n\nStatus: ready-for-agent\n');
  const refused = r.cli('--base', 'HEAD', '--branch', 'origin/ticket/10-y');
  expect(refused.status).toBe(1);
  expect(refused.json.tickets).toEqual([{ path: 'work/tickets/10-y.md', reason: expect.stringContaining('quotes Ada choosing it') }]);
});

it('could not run (exit 2) without a mode or without its consent config', () => {
  const r = repo();
  expect(r.cli()).toMatchObject({ status: 2, json: { gate: 'consent', pass: false, error: 'give --staged or --base <ref>' } });
  r.git('rm', '-q', join('config', 'consent.json'));
  expect(r.cli('--staged')).toMatchObject({ status: 2, json: { error: expect.stringContaining('consent.json is missing') } });
});

it('reads the owner and the lock list from the index in --staged mode, not the working tree (review of 72)', () => {
  const r = repo();
  writeFileSync(join(r.dir, 'package.json'), '{"type":"module","x":1}');
  r.git('add', 'package.json');
  writeFileSync(join(r.dir, 'config', 'locks.json'), '[]');
  expect(r.cli('--staged')).toMatchObject({ status: 1, json: { pass: false, locked: ['package.json'] } });
  rmSync(join(r.dir, 'config', 'locks.json'));
  writeFileSync(join(r.dir, 'work', 'tickets', '9-x.md'), AGREED);
  r.git('add', join('work', 'tickets', '9-x.md'));
  r.git('checkout', '-q', '-b', 'ticket/9-x');
  writeFileSync(join(r.dir, 'config', 'consent.json'), '{"owner":"Eve","tickets":"work/tickets"}');
  expect(r.cli('--staged')).toMatchObject({ status: 0, json: { pass: true, agreed: true } });
});
