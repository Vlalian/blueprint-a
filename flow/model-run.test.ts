import { describe, expect, it } from 'vitest';
import type { Family } from './config.ts';
import { familyNamed, render, reviewerFor, runModel, type ModelIo, type RunResult } from './model-run.ts';

const family = (name: string): Family => ({ name, build: `${name}-cli build --in {prompt}`, review: `${name}-cli review {prompt} --cwd {worktree}`, timeoutMs: 5_000 });
const c = { families: [family('local'), family('cloud'), family('third')] };

describe('Pass when: a change built by one configured family is reviewed by another configured family', () => {
  it('gives a round to the first family that did not build it', () => {
    expect(reviewerFor('local', c).name).toBe('cloud');
    expect(reviewerFor('cloud', c).name).toBe('local');
    expect(reviewerFor('someone', c).name).toBe('local');
  });

  it('takes a requested family that did not build the round', () => {
    expect(reviewerFor('local', c, 'third').name).toBe('third');
  });

  it("refuses the builder's own family", () => {
    expect(() => reviewerFor('local', c, 'local')).toThrow("refusing a review of local's round by local, its own family");
  });

  it('refuses when no other family is configured, naming the stand-in', () => {
    expect(() => reviewerFor('local', { families: [family('local')] })).toThrow(
      'no family but local in config/flow.json to review its round (families: local); add one, or use the stand-in reviewer',
    );
    expect(() => reviewerFor('local', { families: [] })).toThrow('(families: none)');
  });

  it('refuses a family that is not configured', () => {
    expect(() => reviewerFor('local', c, 'codex')).toThrow('no family codex in config/flow.json (families: local, cloud, third)');
    expect(familyNamed(c, 'third').name).toBe('third');
  });
});

describe('a model command', () => {
  it("has its placeholders read from the environment, never written into the command line, unknown braces left alone", () => {
    const values = { prompt: 'a b/p.md', worktree: "wt/$(printf changed)/`id` it's \"x\"" };
    expect(render('agent {prompt} --cwd {worktree} {other} {}', values, 'linux')).toEqual({ command: 'agent "$FLOW_PROMPT" --cwd "$FLOW_WORKTREE" {other} {}', env: { FLOW_PROMPT: 'a b/p.md', FLOW_WORKTREE: values.worktree } });
    expect(render('agent {toString}', {}, 'linux')).toEqual({ command: 'agent {toString}', env: {} });
  });

  it("uses cmd's variables on Windows, where a value expands once and stays inside its double quotes", () => {
    expect(render('agent {prompt} {worktree}', { prompt: 'C:\\a b\\100% & more', worktree: 'C:\\wt\\\\' }, 'win32')).toEqual({
      command: 'agent "%FLOW_PROMPT%" "%FLOW_WORKTREE%"',
      env: { FLOW_PROMPT: 'C:\\a b\\100% & more', FLOW_WORKTREE: 'C:\\wt\\\\\\\\' },
    });
  });

  it('refuses on Windows a value that could leave its double quotes or end the line', () => {
    for (const value of ['say "hi"', 'a\nb', 'a\rb']) expect(() => render('agent {branch}', { branch: value }, 'win32')).toThrow(`{branch} cannot be passed to cmd on Windows: ${JSON.stringify(value)} has a double quote or a line break`);
    expect(render('agent {branch}', { branch: 'say "hi"' }, 'linux').env).toEqual({ FLOW_BRANCH: 'say "hi"' });
  });

  it("runs the family's command for the kind, in the worktree, with the brief on stdin and its timeout", () => {
    const calls: unknown[] = [];
    const io: ModelIo = { platform: 'linux', shell: (...args) => (calls.push(args), { status: 0, stdout: 'out\n', stderr: 'err\n' }) };
    expect(runModel(family('local'), 'review', { prompt: 'p.md', worktree: 'wt' }, 'wt', 'the brief', io)).toEqual({ exitCode: 0, output: 'out\nerr\n', timedOut: false });
    expect(calls).toEqual([['local-cli review "$FLOW_PROMPT" --cwd "$FLOW_WORKTREE"', 'wt', 'the brief', 5_000, { FLOW_PROMPT: 'p.md', FLOW_WORKTREE: 'wt' }]]);
  });

  it('is a failure when it was stopped or never started, with why', () => {
    const io = (r: RunResult): ModelIo => ({ platform: 'win32', shell: () => r });
    expect(runModel(family('local'), 'build', {}, '.', '', io({ status: null, stdout: '', stderr: '', timedOut: true, error: new Error('spawnSync ETIMEDOUT') }))).toEqual({
      exitCode: 1,
      output: 'spawnSync ETIMEDOUT\n',
      timedOut: true,
    });
    expect(runModel(family('local'), 'build', {}, '.', '', io({ status: 3, stdout: '', stderr: 'no' }))).toEqual({ exitCode: 3, output: 'no', timedOut: false });
  });
});
