import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { fakeGh, repoWithRemote } from '../test/helpers/fake-gh.ts';
import { githubHost, type Gh } from '../adapters/host/github.ts';
import { openDraftPr, runPr, type PrIo } from './pr-core.ts';

// Spawns processes: under a full-suite load on Windows they run several times slower (ticket 29).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** Real git in the work clone, the fake gh behind process.execPath. */
function setup(branch = 'ticket/01') {
  const repo = repoWithRemote(branch);
  const gh = fakeGh(repo.remote);
  const io: PrIo = {
    git: (args) => execFileSync('git', args, { cwd: repo.dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }),
    host: githubHost((args) => spawnSync(process.execPath, [gh.script, ...args], { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, ...gh.env } })),
  };
  return { ...repo, gh, io };
}

/** The work clone with the GitHub host on this gh instead. */
const viaGh = (io: PrIo, gh: Gh): PrIo => ({ ...io, host: githubHost(gh) });

const draft = { branch: 'ticket/01', base: 'main', remote: 'origin', title: 'Ticket 01: thing', body: 'Built and reviewed.' };
const remoteHas = (remote: string, ref: string) =>
  spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', '-q', ref], { encoding: 'utf8' }).stdout.trim();

describe('openDraftPr', () => {
  it('pushes the branch and opens a draft PR against the base, never ready', () => {
    const { io, gh, g, remote } = setup();
    const sha = g('rev-parse', 'ticket/01');
    const r = openDraftPr(draft, io);
    expect(r).toEqual({ ok: true, branch: 'ticket/01', sha, url: 'https://github.com/owner/repo/pull/1', number: 1, created: true, draft: true });
    expect(remoteHas(remote, 'refs/heads/ticket/01')).toBe(sha);
    expect(gh.state().prs).toMatchObject([{ headRefName: 'ticket/01', baseRefName: 'main', isDraft: true, title: 'Ticket 01: thing', body: 'Built and reviewed.' }]);
    expect(gh.calls().map((c) => c.slice(0, 2).join(' '))).toEqual(['pr list', 'pr create']);
    expect(gh.calls()[0]).toEqual(['pr', 'list', '--head', 'ticket/01', '--base', 'main', '--state', 'open', '--json', 'number,url,isDraft', '--limit', '1']);
  });

  it('sets the upstream, so the work clone tracks the pushed branch', () => {
    const { io, g } = setup();
    openDraftPr(draft, io);
    expect(g('config', 'branch.ticket/01.remote')).toBe('origin');
  });

  it('pushes again and reuses the open PR on a second call, opening no second PR', () => {
    const { io, gh, g, remote } = setup();
    openDraftPr(draft, io);
    g('checkout', '-q', 'ticket/01');
    g('commit', '-q', '--allow-empty', '-m', 'fix round');
    const sha = g('rev-parse', 'HEAD');
    const r = openDraftPr(draft, io);
    expect(r).toEqual({ ok: true, branch: 'ticket/01', sha, url: 'https://github.com/owner/repo/pull/1', number: 1, created: false, draft: true });
    expect(remoteHas(remote, 'refs/heads/ticket/01')).toBe(sha);
    expect(gh.state().prs).toHaveLength(1);
  });

  it('reports a PR someone already marked ready as not a draft, and leaves it alone', () => {
    const { io, gh } = setup();
    openDraftPr(draft, io);
    gh.setState((s) => (s.prs[0]!.isDraft = false));
    expect(openDraftPr(draft, io)).toMatchObject({ ok: true, created: false, draft: false });
    expect(gh.calls().filter((c) => c[1] !== 'list' && c[1] !== 'create')).toEqual([]);
  });

  it.each([['main'], ['master']])('refuses to push %s by the git rules, touching neither the remote nor gh', (branch) => {
    const { io, gh, remote } = setup();
    const before = remoteHas(remote, 'refs/heads/main');
    const r = openDraftPr({ ...draft, branch }, io);
    expect(r).toEqual({ ok: false, branch, refused: true, error: `push to refs/heads/${branch} is not allowed; push the ticket branch and open a draft PR` });
    expect(remoteHas(remote, 'refs/heads/main')).toBe(before);
    expect(gh.calls()).toEqual([]);
  });

  it('refuses a branch that is its own base', () => {
    const { io, gh } = setup();
    expect(openDraftPr({ ...draft, branch: 'develop', base: 'develop' }, io)).toEqual({ ok: false, branch: 'develop', refused: true, error: 'the PR branch is its own base (develop)' });
    expect(gh.calls()).toEqual([]);
  });

  it('refuses a draft PR against the branch staging is promoted to: promoting is the owner’s step (decision 22)', () => {
    const { io, gh, remote } = setup();
    const r = openDraftPr({ ...draft, base: 'main', promoteTo: 'main' }, io);
    expect(r).toEqual({ ok: false, branch: 'ticket/01', refused: true, error: 'draft PRs never target main: promoting to it is the owner’s step' });
    expect(remoteHas(remote, 'refs/heads/ticket/01')).toBe('');
    expect(gh.calls()).toEqual([]);
  });

  it('opens the draft PR against the integration branch when staging is promoted elsewhere', () => {
    const { io, gh } = setup();
    expect(openDraftPr({ ...draft, base: 'dev', promoteTo: 'main' }, io)).toMatchObject({ ok: true, created: true, draft: true });
    expect(gh.state().prs).toMatchObject([{ headRefName: 'ticket/01', baseRefName: 'dev', isDraft: true }]);
  });

  it('fails without calling gh when the push fails', () => {
    const { io, gh } = setup();
    const r = openDraftPr({ ...draft, remote: 'nowhere' }, io);
    expect(r).toMatchObject({ ok: false, branch: 'ticket/01', error: expect.stringMatching(/nowhere/) });
    expect(r).not.toHaveProperty('refused');
    expect(gh.calls()).toEqual([]);
  });

  it('fails with gh stderr when gh fails', () => {
    const { io, gh } = setup();
    gh.setState((s) => (s.fail = 'HTTP 401: Bad credentials'));
    expect(openDraftPr(draft, io)).toEqual({ ok: false, branch: 'ticket/01', error: 'gh pr list failed: HTTP 401: Bad credentials' });
  });

  it('fails with the exit code when gh fails silently', () => {
    const { io } = setup();
    const silent: PrIo = viaGh(io, () => ({ status: 1, stdout: '', stderr: '' }));
    expect(openDraftPr(draft, silent)).toMatchObject({ ok: false, error: 'gh pr list failed: exit 1' });
  });

  it('fails when the last line gh pr create prints is not a PR URL', () => {
    const { io } = setup();
    const odd: PrIo = viaGh(io, (args) => ({ status: 0, stdout: args[1] === 'list' ? '[]' : 'https://github.com/o/r/pull/7/files\n', stderr: '' }));
    expect(openDraftPr(draft, odd)).toMatchObject({ ok: false, error: 'gh pr create printed no PR URL: https://github.com/o/r/pull/7/files' });
  });

  it('fails with the spawn error when gh cannot start', () => {
    const { io } = setup();
    const broken: PrIo = viaGh(io, () => ({ status: null, stdout: '', stderr: '', error: new Error('spawn gh ENOENT') }));
    expect(openDraftPr(draft, broken)).toMatchObject({ ok: false, error: 'gh pr list failed: spawn gh ENOENT' });
  });

  it('fails when gh pr create prints no PR URL', () => {
    const { io } = setup();
    const odd: PrIo = viaGh(io, (args) => (args[1] === 'list' ? { status: 0, stdout: '[]\n', stderr: '' } : { status: 0, stdout: 'Creating pull request...\n', stderr: '' }));
    expect(openDraftPr(draft, odd)).toMatchObject({ ok: false, error: 'gh pr create printed no PR URL: Creating pull request...' });
  });

  it('takes the URL from the last line gh pr create prints', () => {
    const { io } = setup();
    const chatty: PrIo = viaGh(io, (args) =>
      args[1] === 'list' ? { status: 0, stdout: '[]', stderr: '' } : { status: 0, stdout: 'Warning: 1 uncommitted change\nhttps://github.com/o/r/pull/42\n\n', stderr: '' },
    );
    expect(openDraftPr(draft, chatty)).toMatchObject({ ok: true, url: 'https://github.com/o/r/pull/42', number: 42 });
  });
});

describe('openDraftPr on any host', () => {
  it('pushes with git, then opens the PR only through the host adapter', () => {
    const { io, gh, g } = setup();
    const asked: string[][] = [];
    const host: PrIo['host'] = { openDraftPr: (...args) => (asked.push(args), { id: 22, url: 'https://dev.azure.com/o/p/_git/r/pullrequest/22', created: true, draft: true }) };
    expect(openDraftPr(draft, { ...io, host })).toEqual({ ok: true, branch: 'ticket/01', sha: g('rev-parse', 'ticket/01'), url: 'https://dev.azure.com/o/p/_git/r/pullrequest/22', number: 22, created: true, draft: true });
    expect(asked).toEqual([['ticket/01', 'main', 'Ticket 01: thing', 'Built and reviewed.']]);
    expect(gh.calls()).toEqual([]);
  });

  it('fails with the host error, the token never in it', () => {
    const { io } = setup();
    const host: PrIo['host'] = {
      openDraftPr: () => {
        throw new Error('Azure DevOps POST git/repositories/r/pullrequests answered 401: [redacted]');
      },
    };
    expect(openDraftPr(draft, { ...io, host })).toEqual({ ok: false, branch: 'ticket/01', error: 'Azure DevOps POST git/repositories/r/pullrequests answered 401: [redacted]' });
  });
});

describe('runPr (the CLI core)', () => {
  const argv = ['--branch', 'ticket/01', '--title', 'Ticket 01: thing'];

  it('exits 0 with the PR, defaulting base main, remote origin, an empty body and the current folder', () => {
    const { io, gh } = setup();
    const seen: string[] = [];
    const r = runPr(argv, (cwd) => (seen.push(cwd), io));
    expect(r).toMatchObject({ exitCode: 0, json: { ok: true, number: 1, draft: true } });
    expect(seen).toEqual(['.']);
    expect(gh.state().prs[0]).toMatchObject({ baseRefName: 'main', body: '' });
  });

  it('passes --base, --remote, --body and --cwd through', () => {
    const { io, gh, g } = setup();
    g('remote', 'rename', 'origin', 'upstream');
    const seen: string[] = [];
    const r = runPr([...argv, '--base', 'main', '--remote', 'upstream', '--body', 'why', '--cwd', 'work'], (cwd) => (seen.push(cwd), io));
    expect(r.exitCode).toBe(0);
    expect(seen).toEqual(['work']);
    expect(gh.state().prs[0]).toMatchObject({ body: 'why' });
  });

  it('with --project, opens the draft PR against the project’s integration branch (decision 22)', () => {
    const { io, gh } = setup();
    const asked: string[] = [];
    const project = (name: string) => (asked.push(name), { integrationBranch: 'dev', promoteTo: 'main' });
    expect(runPr([...argv, '--project', 'app'], () => io, project)).toMatchObject({ exitCode: 0, json: { ok: true } });
    expect(asked).toEqual(['app']);
    expect(gh.state().prs[0]).toMatchObject({ baseRefName: 'dev' });
  });

  it('with --project, refuses --base set to the branch staging is promoted to (exit 1)', () => {
    const { io, gh } = setup();
    const r = runPr([...argv, '--project', 'app', '--base', 'main'], () => io, () => ({ integrationBranch: 'dev', promoteTo: 'main' }));
    expect(r).toMatchObject({ exitCode: 1, json: { refused: true, error: 'draft PRs never target main: promoting to it is the owner’s step' } });
    expect(gh.calls()).toEqual([]);
  });

  it('asks for the GitHub host without --project, and for the host the project’s "pr" names with it', () => {
    const { io } = setup();
    const hosts: unknown[] = [];
    runPr(argv, (_cwd, host) => (hosts.push(host), io));
    const azure = { host: 'azure-devops', organization: 'o', project: 'p', repository: 'r' };
    runPr([...argv, '--project', 'work'], (_cwd, host) => (hosts.push(host), io), () => ({ pr: { remote: 'origin', base: 'dev', ...azure } }));
    expect(hosts).toEqual([{ host: 'github' }, azure]);
  });

  it('exits 2 when the project names a host it does not know, calling nothing', () => {
    const { io, gh } = setup();
    expect(runPr([...argv, '--project', 'odd'], () => io, () => ({ pr: { host: 'gitlab' } }))).toEqual({ exitCode: 2, json: { ok: false, error: '"pr" "host" is github or azure-devops, not "gitlab"' } });
    expect(gh.calls()).toEqual([]);
  });

  it('with --project and no staging in it, defaults base main', () => {
    const { io, gh } = setup();
    expect(runPr([...argv, '--project', 'app'], () => io, () => ({}))).toMatchObject({ exitCode: 0 });
    expect(gh.state().prs[0]).toMatchObject({ baseRefName: 'main' });
  });

  it('exits 2 when --project names a project that cannot be read, calling nothing', () => {
    const { io, gh } = setup();
    const r = runPr([...argv, '--project', 'nope'], () => io, () => {
      throw new Error('no projects/nope/project.json');
    });
    expect(r).toEqual({ exitCode: 2, json: { ok: false, error: 'no projects/nope/project.json' } });
    expect(gh.calls()).toEqual([]);
  });

  it('reads no project without --project', () => {
    const { io } = setup();
    const read = () => {
      throw new Error('read');
    };
    expect(runPr(argv, () => io, read)).toMatchObject({ exitCode: 0 });
  });

  it('exits 1 when the rules refuse the push', () => {
    const { io } = setup();
    expect(runPr(['--branch', 'main', '--title', 't'], () => io)).toMatchObject({ exitCode: 1, json: { refused: true } });
  });

  it('exits 2 when the push or gh fails', () => {
    const { io } = setup();
    expect(runPr([...argv, '--remote', 'nowhere'], () => io)).toMatchObject({ exitCode: 2, json: { ok: false } });
  });

  it.each([
    ['no --branch', ['--title', 't'], /^--branch is required/],
    ['no --title', ['--branch', 'ticket/01'], /^--title is required/],
    ['an unknown option', [...['--branch', 'b', '--title', 't'], '--ready'], /ready/],
  ])('exits 2 with a usage error on %s, calling nothing', (_label, args, error) => {
    const { io, gh } = setup();
    const r = runPr(args, () => io);
    expect(r).toMatchObject({ exitCode: 2, json: { ok: false, error: expect.stringMatching(error) } });
    expect(gh.calls()).toEqual([]);
  });
});
