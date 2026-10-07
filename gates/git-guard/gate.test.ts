import { describe, expect, it } from 'vitest';
import { gitGuard } from './gate.ts';

describe('gitGuard', () => {
  it('passes a command line the git rules allow', () => {
    expect(gitGuard(['--branch', 'feature/x', 'git status && git push origin feature/x'])).toEqual({ gate: 'git-guard', pass: true, blocked: [] });
  });

  it('blocks each simple command a git or gh rule refuses, naming it and why', () => {
    const result = gitGuard(['--branch', 'feature/x', 'git push --force origin feature/x; gh pr merge 12']);
    expect(result).toMatchObject({ pass: false });
    expect((result.blocked as Array<{ command: string }>).map((b) => b.command)).toEqual(['git push --force origin feature/x', 'gh pr merge 12']);
    expect((result.blocked as Array<{ reason: string }>)[1]!.reason).toMatch(/merging is .+'s call \(tier 4\)/);
  });

  it('judges a push by the branch it is told is checked out', () => {
    expect(gitGuard(['--branch', 'main', 'git push origin HEAD'])).toMatchObject({ pass: false });
    expect(gitGuard(['--branch', 'feature/x', 'git push origin HEAD'])).toMatchObject({ pass: true });
  });

  it('blocks a line that turns the hooks off through the environment', () => {
    expect(gitGuard(['--branch', 'feature/x', 'HUSKY=0 git commit -m x'])).toEqual({
      gate: 'git-guard',
      pass: false,
      blocked: [{ command: 'HUSKY=0 git commit -m x', reason: 'HUSKY=0 can turn the git hooks off; agents never set it' }],
    });
  });

  it('reads PowerShell and cmd when told to', () => {
    expect(gitGuard(['--branch', 'feature/x', '--dialect', 'powershell', '$env:HUSKY=0; git commit'])).toMatchObject({ pass: false });
    expect(gitGuard(['--branch', 'feature/x', '--dialect', 'cmd', 'git status & git push -f origin feature/x'])).toMatchObject({ pass: false });
  });

  it('refuses to run without a branch, a command line or a known dialect', () => {
    const usage = 'usage: git-guard --branch <checked-out branch> [--dialect sh|powershell|cmd] <command line>';
    expect(() => gitGuard(['git status'])).toThrow(usage);
    expect(() => gitGuard(['--branch', 'x'])).toThrow(usage);
    expect(() => gitGuard(['--branch', 'x', '--dialect', 'fish', 'git status'])).toThrow(usage);
  });
});
