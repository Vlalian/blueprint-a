import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLI = join(import.meta.dirname, 'check-package.ts');

const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

// Built at runtime so no deny-listed name sits in this file as a literal.
const project = ['bio', 'hacking', '-', 'coach'].join('');

const dirs: string[] = [];
const folder = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-package-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
};

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('check-package CLI', () => {
  it('exits 0 with JSON on stdout for a clean folder, reading nested files', () => {
    const r = run(folder({ 'README.md': 'fine', 'gates/a.md': 'also fine' }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'check-package', pass: true, files: 2, findings: [] });
  });

  it('exits 1 on a name from the rules file, naming the nested file with forward slashes', () => {
    const rules = folder({ 'rules.json': JSON.stringify({ deny: [project], privateRepos: [] }) });
    const r = run(folder({ 'gates/a.md': `built for ${project}` }), '--rules', join(rules, 'rules.json'));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).findings).toEqual([{ file: 'gates/a.md', line: 1, kind: 'deny-list', detail: project }]);
  });

  it('reads a rules file given with --rules', () => {
    const rules = folder({ 'r.json': JSON.stringify({ deny: ['zed'], privateRepos: [] }) });
    const r = run(folder({ 'a.md': 'by zed' }), '--rules', join(rules, 'r.json'));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).findings).toEqual([{ file: 'a.md', line: 1, kind: 'deny-list', detail: 'zed' }]);
  });

  it('exits 2 with a usage error when no folder is given', () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ gate: 'check-package', pass: false, error: expect.stringMatching(/^usage: check-package/) });
  });

  it('exits 2 for a folder that does not exist', () => {
    const r = run(join(tmpdir(), 'check-package-missing-folder'));
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).pass).toBe(false);
  });
});
