import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { addedLines } from '../lib/diff.ts';
import { worktreeDiff, worktreeTree } from './tree.ts';

// Spawns git: under a full-suite load on Windows it runs several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim();

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'));
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 't'], ['config', 'user.email', 't@localhost']]) git(dir, ...args);
  writeFileSync(join(dir, '.gitignore'), '.env.local\n');
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

describe('worktreeTree', () => {
  it('is the committed tree on a clean worktree, and stays so when nothing changes', () => {
    const dir = repo();
    expect(worktreeTree(dir)).toBe(git(dir, 'rev-parse', 'HEAD^{tree}'));
    expect(worktreeTree(dir)).toBe(worktreeTree(dir));
  });

  it('changes with an edited file and with a new untracked file, but not with an ignored one', () => {
    const dir = repo();
    const clean = worktreeTree(dir);
    writeFileSync(join(dir, '.env.local'), 'A=1\n');
    expect(worktreeTree(dir)).toBe(clean);
    writeFileSync(join(dir, 'b.ts'), 'export const b = 2;\n');
    const untracked = worktreeTree(dir);
    expect(untracked).not.toBe(clean);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 3;\n');
    expect(worktreeTree(dir)).not.toBe(untracked);
  });

  it('leaves the real index and git status as they were', () => {
    const dir = repo();
    writeFileSync(join(dir, 'b.ts'), 'x\n');
    const index = readFileSync(join(dir, '.git', 'index'));
    worktreeTree(dir);
    expect(readFileSync(join(dir, '.git', 'index'))).toEqual(index);
    expect(git(dir, 'status', '--porcelain')).toBe('?? b.ts');
    expect(git(dir, 'status', '--porcelain', '--ignored')).not.toContain('workflow-tree');
  });

  it('names a tree in a repo with no commit yet, and none outside a repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tree-'));
    expect(worktreeTree(dir)).toBeUndefined();
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'a.ts'), 'x\n');
    expect(worktreeTree(dir)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('worktreeDiff (ticket 47)', () => {
  it("is the worktree's added lines against HEAD, untracked files included and ignored ones left out, leaving the index as it was", () => {
    const dir = repo();
    expect(worktreeDiff(dir)).toBe('');
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\nconsole.log(a);\n');
    writeFileSync(join(dir, 'b.ts'), 'debugger;\n');
    writeFileSync(join(dir, '.env.local'), 'console.log(secret)\n');
    const diff = worktreeDiff(dir)!;
    expect(addedLines(diff)).toEqual([
      { file: 'a.ts', line: 2, text: 'console.log(a);' },
      { file: 'b.ts', line: 1, text: 'debugger;' },
    ]);
    expect(git(dir, 'status', '--porcelain')).toBe('M a.ts\n?? b.ts');
  });

  it('is undefined outside a git repo and before the first commit', () => {
    expect(worktreeDiff(mkdtempSync(join(tmpdir(), 'no-git-')))).toBeUndefined();
    const fresh = mkdtempSync(join(tmpdir(), 'fresh-'));
    git(fresh, 'init', '-q');
    expect(worktreeDiff(fresh)).toBeUndefined();
  });
});
