// The pre-commit renderer (install-pre-commit-core.ts).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPreCommit, shellQuote } from './install-pre-commit-core.ts';

const ROOT = resolve(import.meta.dirname, '..');
const template = readFileSync(join(ROOT, 'adapters/git/pre-commit.template'), 'utf8');

describe('renderPreCommit', () => {
  it('runs the secret and hidden-Unicode scans on the staged lines, and no guard ticket 95 deleted', () => {
    expect(template).toContain('"$NODE" "$GATES/secret-scan/cli.ts" --staged');
    expect(template).toContain('"$NODE" "$GATES/hidden-unicode/cli.ts" --staged');
    expect(template).not.toMatch(/GATES\/(tamper|locks)\//);
  });

  it('copies dollar signs in a check or path as they are (no replacement patterns)', () => {
    const out = renderPreCommit('__NODE__|__WORKFLOW_HOME__\n__PROJECT_CHECKS__', { node: "n$&", workflowHome: "w$'", checks: ['echo $$ $& x'] });
    expect(out.split('\n')[0]).toBe("n$&|w$'");
    expect(out).toContain('echo $$ $& x || {');
  });

  it('fills in node, the workflow home with forward slashes, and the project checks', () => {
    const out = renderPreCommit(template, { node: String.raw`C:\node\node.exe`, workflowHome: String.raw`C:\wf`, checks: ['npm test'] });
    expect(out).toContain('NODE="C:/node/node.exe"');
    expect(out).toContain('GATES="C:/wf/gates"');
    expect(out).toContain(`npm test || { echo "pre-commit: project check failed:" 'npm test' >&2; exit 1; }`);
    expect(out).not.toMatch(/__[A-Z_]+__/);
  });

  it('puts each project check on its own line, with the failing command quoted once', () => {
    const out = renderPreCommit('__NODE__|__WORKFLOW_HOME__\n__PROJECT_CHECKS__', { node: 'n', workflowHome: 'w', checks: ['a', 'b'] });
    expect(out).toBe([
      'n|w',
      `a || { echo "pre-commit: project check failed:" 'a' >&2; exit 1; }`,
      `b || { echo "pre-commit: project check failed:" 'b' >&2; exit 1; }`,
    ].join('\n'));
  });
});

describe('shellQuote', () => {
  it('closes, escapes and reopens around each single quote', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});
