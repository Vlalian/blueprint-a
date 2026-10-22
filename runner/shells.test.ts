import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { declaresShell, LS_SOURCES, processShells, SHELL_MARK, shellsIn } from './shells.ts';

// The merge test spawns git a dozen times; under load on Windows that is slow. The load rule
// (spawn-timeouts.ts) asks the same of every test in a file that spawns.
const SPAWNS = 60_000;
vi.setConfig({ testTimeout: SPAWNS, hookTimeout: SPAWNS });

describe('declaresShell — a process shell says so in its own file (ticket 56)', () => {
  it('reads the marker on a line of its own, anywhere in the file', () => {
    expect(declaresShell(`// node x.ts\n${SHELL_MARK}\nimport x from 'y';\n`)).toBe(true);
    expect(declaresShell(`${SHELL_MARK}\r\nimport x from 'y';\r\n`)).toBe(true);
  });

  it('ignores a file without it, the marker quoted inside other text, or no file', () => {
    expect(declaresShell("import x from 'y';\n")).toBe(false);
    expect(declaresShell(`const s = '${SHELL_MARK}';\n`)).toBe(false);
    expect(declaresShell(`${SHELL_MARK} and more\n`)).toBe(false);
    expect(declaresShell(`run(); ${SHELL_MARK}\n`)).toBe(false);
    expect(declaresShell(undefined)).toBe(false);
  });
});

describe('processShells — the frozen list plus every file that declares itself', () => {
  const texts: Record<string, string> = { 'a/cli.ts': `${SHELL_MARK}\n`, 'b/core.ts': 'export {};\n', 'c/io.ts': `// io\n${SHELL_MARK}\n`, 'old/cli.ts': `${SHELL_MARK}\n` };
  const read = (p: string) => texts[p];

  it('keeps the listed shells first, then the declared ones in path order, each once', () => {
    expect(processShells(['old/cli.ts', 'z/x.ts'], ['c/io.ts', 'b/core.ts', 'a/cli.ts', 'old/cli.ts'], read)).toEqual(['old/cli.ts', 'z/x.ts', 'a/cli.ts', 'c/io.ts']);
  });

  it('reads only TypeScript sources, not tests', () => {
    const seen: string[] = [];
    processShells([], ['a/cli.ts', 'a/cli.test.ts', 'docs/x.md'], (p) => (seen.push(p), read(p)));
    expect(seen).toEqual(['a/cli.ts']);
  });
});

describe('shellsIn — over git ls-files output', () => {
  it('splits the listing, Windows line ends too', () => {
    const read = (p: string) => (p === 'a/cli.ts' ? `${SHELL_MARK}\n` : '');
    expect(shellsIn(['x.ts'], 'a/cli.ts\r\nb.ts\n\n', read)).toEqual(['x.ts', 'a/cli.ts']);
    expect(LS_SOURCES).toEqual(['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.ts']);
  });
});

function git(cwd: string, ...args: string[]): { status: number | null; stdout: string } {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function commitFile(repo: string, file: string, text: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), text);
  git(repo, 'add', '--', file);
  git(repo, 'commit', '-q', '-m', file);
}

describe('two tickets that each add a shell (ticket 56 Pass when)', () => {
  it('merge without a conflict, and both shells are exempt after the merge', () => {
    const repo = mkdtempSync(join(tmpdir(), 'shells-'));
    try {
      git(repo, 'init', '-q', '-b', 'main');
      for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(repo, 'config', k, v);
      commitFile(repo, join('scripts', 'core.ts'), 'export const x = 1;\n');
      git(repo, 'checkout', '-q', '-b', 'ticket/a');
      commitFile(repo, join('scripts', 'a.ts'), `// node scripts/a.ts\n${SHELL_MARK}\n`);
      git(repo, 'checkout', '-q', '-b', 'ticket/b', 'main');
      commitFile(repo, join('scripts', 'b.ts'), `// node scripts/b.ts\n${SHELL_MARK}\n`);
      git(repo, 'checkout', '-q', 'main');
      expect(git(repo, 'merge', '-q', '--no-ff', '-m', 'a', 'ticket/a').status).toBe(0);
      expect(git(repo, 'merge', '-q', '--no-ff', '-m', 'b', 'ticket/b').status).toBe(0);
      const files = git(repo, 'ls-files').stdout.split('\n').filter(Boolean);
      expect(processShells([], files, (p) => readFileSync(join(repo, p), 'utf8'))).toEqual(['scripts/a.ts', 'scripts/b.ts']);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, SPAWNS);
});
