import { describe, expect, it } from 'vitest';
import { commandsOf, readLine } from './shell-parse.ts';
import { blockedReason, hookEnvReason } from './git-rules.ts';

const check = (line: string, branch = 'ticket/01') =>
  commandsOf(line).map((words) => blockedReason(words, { currentBranch: branch })).find(Boolean);

const FORCE = 'force push is never allowed';
const DELETE = 'deleting a remote branch is not allowed';
const HOOKS = 'skipping git hooks (--no-verify) is not allowed';
const HOOKS_PATH = 'changing core.hooksPath is not allowed';
const ALIAS = 'defining a git alias is not allowed; it can hide a blocked command';
const CLEAN = 'clean -f is not allowed; it deletes untracked work';
const RESET = 'reset --hard is not allowed; it destroys work';
const BRANCH_D = 'force-deleting a branch is not allowed';
const DISCARD = 'discarding all changes is not allowed';
const ALL = 'pushing every branch is not allowed; it pushes main too';
// A refusal of a push form the guard does not read in full; the exact words are tested once below.
const FORM = expect.stringMatching(/^this git push is not a form the guard reads in full, so it is not allowed; the forms allowed: /);
const toMain = (ref: string) => `push to ${ref} is not allowed; push the ticket branch and open a draft PR`;

describe('blockedReason: what an agent may not do with git and gh', () => {
  it.each([
    'git status',
    'git',
    'git --version',
    'git constructor',
    'git diff --stat',
    'git add -A',
    'git commit -m "ticket 01: add slugify"',
    'git commit --no-edit',
    'git commit -m x -- a.ts',
    'git merge -n ticket/02',
    'git push origin ticket/01',
    'git push origin ticket/01:ticket/01',
    'git push origin refs/heads/ticket/01',
    'git push origin HEAD:heads/ticket/01',
    'git push -u origin HEAD',
    'git -c user.name=x commit -m y',
    'git -C ../other status',
    'git config user.name x',
    'git checkout -b ticket/02',
    'git checkout -',
    'git checkout src/a.ts',
    'git restore src/a.ts',
    'git switch ticket/02',
    'git branch -d ticket/01',
    'git branch -f ticket/01 HEAD~1',
    'git clean -n',
    'git reset --soft HEAD~1',
    'git log --oneline -n 5',
    'gh pr create --draft --title x --body y',
    'gh pr view 12',
    'gh pr list',
    'gh api repos/o/r/pulls/12',
    'gh issue view 3',
    'gh issue create --title merge',
    'gh issue create --title ready',
    'gh search code /pulls/1/merge',
    'git add alias.ts',
    'git commit -m-n',
    'hg push --force',
    'npm test',
  ])('allows %s', (line) => {
    expect(check(line)).toBeUndefined();
  });

  it.each([
    ['git push --force', FORCE],
    ['git push -f origin ticket/01', FORCE],
    ['git push -uf origin ticket/01', FORCE],
    ['git push --forc origin ticket/01', FORCE],
    ['git push --force-with-lease', FORCE],
    ['git push --force-with-lease=main:abc origin ticket/01', FORCE],
    ['git push --mirror origin', FORCE],
    ['git push --mirr origin', FORCE],
    ['git push origin +ticket/01', FORCE],
    ['git push origin main', FORM],
    ['git push origin master', FORM],
    ['git push origin HEAD:master', FORM],
    ['git push origin refs/heads/main', FORM],
    ['git push origin HEAD:refs/heads/master', FORM],
    ['git push origin HEAD:heads/main', FORM],
    ['git push origin heads/master', FORM],
    ["git push origin 'refs/heads/*:refs/heads/*'", FORM],
    ['git push --all origin', ALL],
    ['git push --branches origin', ALL],
    ['git push --delete origin ticket/01', DELETE],
    ['git push --del origin ticket/01', DELETE],
    ['git push -d origin ticket/01', DELETE],
    ['git push origin :ticket/01', DELETE],
    ['git push --prune origin', DELETE],
    ['git commit --no-verify -m x', HOOKS],
    ['git commit --no-verif -m x', HOOKS],
    ['git commit -nm x', HOOKS],
    ['git commit -n', HOOKS],
    ['git merge --no-verify x', HOOKS],
    ['git rebase --no-verify main', HOOKS],
    ['git cherry-pick --no-verify abc', HOOKS],
    ['git am --no-verify x.patch', HOOKS],
    ['git push --no-verify origin ticket/01', HOOKS],
    ['git -c core.hooksPath=/dev/null commit -m x', HOOKS_PATH],
    ['git -c CORE.HOOKSPATH=x commit -m x', HOOKS_PATH],
    ['git --config-env=core.hooksPath=X commit -m x', HOOKS_PATH],
    ['git config core.hooksPath .nohooks', HOOKS_PATH],
    ['git config --unset core.hooksPath', HOOKS_PATH],
    ['git -c alias.p=push p --force', ALIAS],
    ['git --config-env=alias.p=X p', ALIAS],
    ["git config alias.p 'push --force'", ALIAS],
    ['git -c clean.requireForce=false clean -d', CLEAN],
    ['git reset --hard HEAD~1', RESET],
    ['git reset --har HEAD~1', RESET],
    ['git clean -fd', CLEAN],
    ['git clean --force -d', CLEAN],
    ['git clean --forc -d', CLEAN],
    ['git branch -D ticket/01', BRANCH_D],
    ['git branch -vD ticket/01', BRANCH_D],
    ['git branch --delete --force x', BRANCH_D],
    ['git branch -d -f x', BRANCH_D],
    ['git branch -df x', BRANCH_D],
    ['git branch --delete -f x', BRANCH_D],
    ['git branch -d --force x', BRANCH_D],
    ['git checkout .', DISCARD],
    ['git checkout -- .', DISCARD],
    ['git checkout ./', DISCARD],
    ['git checkout ..', DISCARD],
    ['git checkout ../', DISCARD],
    ['git checkout :/', DISCARD],
    ["git restore '*'", DISCARD],
    ['git restore .', DISCARD],
    ['git checkout -f main', DISCARD],
    ['git checkout --force main', DISCARD],
    ['git switch --discard-changes main', DISCARD],
    ['git switch -f main', DISCARD],
    ['gh pr merge 12', "merging is the owner's call (tier 4)"],
    ['gh pr -R o/r merge 12', "merging is the owner's call (tier 4)"],
    ['gh pr ready 12', "marking a PR ready is the owner's call (tier 4)"],
    ['gh pr --repo o/r ready 12', "marking a PR ready is the owner's call (tier 4)"],
    ['gh api -X PUT repos/o/r/pulls/12/merge', "merging or readying a PR through the API is the owner's call (tier 4)"],
    ["gh api graphql -f 'query=mutation { mergePullRequest(input: {}) { clientMutationId } }'", "merging or readying a PR through the API is the owner's call (tier 4)"],
    ["gh api graphql -f 'query=mutation { markPullRequestReadyForReview(input: {}) { clientMutationId } }'", "merging or readying a PR through the API is the owner's call (tier 4)"],
    ["gh api graphql -f 'query=mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'", "merging or readying a PR through the API is the owner's call (tier 4)"],
    ["gh alias set m 'pr merge'", 'defining a gh alias is not allowed; it can hide a blocked command'],
  ])('blocks %s', (line, why) => {
    expect(check(line)).toEqual(why);
  });

  it.each(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--attr-source'])(
    'reads the value of the global option %s as a value, not as the subcommand',
    (option) => {
      expect(check(`git ${option} x push --force`)).toBe(FORCE);
    },
  );

  it('blocks a bare push while on main, options or not', () => {
    expect(check('git push', 'main')).toBe('push to main is not allowed; you are on main');
    expect(check('git push -u origin', 'main')).toBe('push to main is not allowed; you are on main');
    expect(check('git push origin', 'master')).toBe('push to master is not allowed; you are on master');
    expect(check('git push', 'ticket/01')).toBeUndefined();
  });

  describe('allows only the push forms it reads in full (review round 4), and refuses every other', () => {
    const withConfig = (line: string, values: Record<string, string[]>, branch = 'ticket/01') =>
      commandsOf(line).map((words) => blockedReason(words, { currentBranch: branch, config: (key) => values[key] ?? [] })).find(Boolean);
    const MIRROR_ORIGIN = { 'remote.origin.mirror': ['true'] };

    it('blocks git push --repo=safe --no-repo from ticket/63 with remote.origin.mirror=true: git drops safe and mirror-pushes to origin', () => {
      expect(withConfig('git push --repo=safe --no-repo', MIRROR_ORIGIN, 'ticket/63')).toEqual(FORM);
      expect(withConfig('git push --no-repo', MIRROR_ORIGIN, 'ticket/63')).toEqual(FORM);
      expect(check('git push --repo=safe --no-repo', 'ticket/63')).toEqual(FORM);
    });

    it.each([
      // Review round 1: a -c override sets where the push goes.
      'git -c remote.origin.push=ticket/63:refs/heads/main push origin',
      // Review round 2: -c overrides that make it a mirror push, or a push of every matching branch.
      'git -c remote.origin.mirror=true push origin',
      'git -c remote.origin.push=: push origin',
      // Review round 3: -o's value glued, and an option that takes the next word.
      'git push -ohello origin main',
      'git push --recurse-submodules no origin',
      // The first finding: --repo with a refspec git reads as the repository.
      'git push --repo=origin main',
    ])('refuses %s from ticket/63, an earlier review finding', (line) => {
      expect(withConfig(line, MIRROR_ORIGIN, 'ticket/63')).toEqual(FORM);
      expect(check(line, 'ticket/63')).toEqual(FORM);
    });

    it.each([
      '-C . push origin ticket/01',
      '-c user.name=x push origin ticket/01',
      '--config-env=user.name=N push origin',
      '--git-dir=.git push',
      '--no-pager push',
    ])('refuses git %s: no git option before push', (words) => {
      expect(check(`git ${words}`)).toEqual(FORM);
    });

    it.each([
      '-q',
      '--no-repo',
      '-o x origin',
      '--push-option=x origin',
      '--repo origin',
      '--rep=origin',
      '-uq origin',
      '--set-up origin',
      '--receive-pack=x origin',
      '--exec=x origin',
      '--tags origin',
      '--follow-tags origin',
      '--atomic origin',
      '--dry-run origin',
      '--force-if-includes origin ticket/01',
      '-- origin',
      '- origin',
      'origin -- ticket/01',
      'origin ticket/01 ticket/01',
      '. HEAD:ticket/01',
      '../x',
      'https://example.com/r.git',
      'origin HEAD:HEAD',
      'origin ticket/01:ticket/01:x',
      'origin ticket/02',
      'origin ticket/01:ticket/02',
      'origin HEAD:refs/heads/mainline',
      'origin heads/ticket/01',
      'origin main',
      'origin HEAD:main',
      'origin refs/heads/ticket/01:refs/heads/main',
    ])('refuses git push %s from ticket/01', (words) => {
      expect(check(`git push ${words}`)).toEqual(FORM);
    });

    it.each([
      '',
      '-u',
      'origin',
      '-u origin ticket/01',
      '--set-upstream origin HEAD',
      'origin ticket/01 -u',
      'origin @',
      'origin HEAD:ticket/01',
      'origin @:heads/ticket/01',
      'origin refs/heads/ticket/01:refs/heads/ticket/01',
      'origin_2 ticket/01',
      'up.stream ticket/01',
      'my-remote ticket/01',
    ])('allows git push %s from ticket/01', (words) => {
      expect(check(`git push ${words}`)).toBeUndefined();
    });

    it('names the allowed forms when it refuses one', () => {
      expect(check('git push --no-repo')).toBe(
        'this git push is not a form the guard reads in full, so it is not allowed; the forms allowed: git push [-u|--set-upstream] [<remote> [<branch>[:<branch>]]], where <branch> is the checked-out branch (HEAD, @ or refs/heads/<branch> too), with no git option before push and no other push option',
      );
    });
  });

  describe('an allowed push still goes where git config sends it', () => {
    const withConfig = (line: string, values: Record<string, string[]>, branch = 'ticket/01') =>
      commandsOf(line).map((words) => blockedReason(words, { currentBranch: branch, config: (key) => values[key] ?? [] })).find(Boolean);
    const MAPPED = { 'remote.origin.push': ['ticket/01:refs/heads/main'] };

    it('blocks a push that remote.<name>.push maps to main, from a ticket branch', () => {
      expect(withConfig('git push origin', MAPPED)).toBe(toMain('refs/heads/main'));
      expect(withConfig('git push', MAPPED)).toBe(toMain('refs/heads/main'));
      expect(withConfig('git push -u origin', MAPPED)).toBe(toMain('refs/heads/main'));
    });

    it('blocks a refspec without :<dst> that remote.<name>.push maps to main', () => {
      expect(withConfig('git push origin ticket/01', MAPPED)).toBe(toMain('refs/heads/main'));
      expect(withConfig('git push origin HEAD', MAPPED)).toBe(toMain('refs/heads/main'));
      expect(withConfig('git push origin ticket/02', { 'remote.origin.push': ['refs/heads/ticket/02:refs/heads/master'] }, 'ticket/02')).toBe(toMain('refs/heads/master'));
      expect(withConfig('git push origin ticket/01', { 'remote.origin.push': ['ticket/02:refs/heads/main'] })).toBeUndefined();
      expect(withConfig('git push origin ticket/01:ticket/01', MAPPED)).toBeUndefined();
    });

    it('maps a source given with refs/heads/ in remote.<name>.push, and only that name; one with + is a force push', () => {
      expect(withConfig('git push origin ticket/02', { 'remote.origin.push': ['+ticket/02:refs/heads/main'] }, 'ticket/02')).toBe(FORCE);
      expect(withConfig('git push origin xticket/02', { 'remote.origin.push': ['ticket/02:main'] }, 'xticket/02')).toBeUndefined();
      expect(withConfig('git push origin refs/heads/ticket/02', { 'remote.origin.push': ['ticket/02:main'] }, 'ticket/02')).toBe(toMain('main'));
      expect(withConfig('git push origin ab', { 'remote.origin.push': ['a+b:main'] }, 'ab')).toBeUndefined();
      expect(withConfig('git push origin team/x', { 'remote.origin.push': ['team/refs/heads/x:main'] }, 'team/x')).toBeUndefined();
      // A configured refspec without :<dst> pushes its source to the same name.
      expect(withConfig('git push origin heads/main', { 'remote.origin.push': ['heads/main'] }, 'heads/main')).toBe(toMain('heads/main'));
    });

    describe('reads push config that git turns into --mirror, a forced update or a push of every branch', () => {
      const MIRROR = 'a mirror push (remote.<name>.mirror) is not allowed; it force-pushes and deletes every branch, main too';

      it('reads mirror from the config or bare, on the remote the push goes to', () => {
        expect(withConfig('git push origin', { 'remote.origin.mirror': [''] }, 'ticket/63')).toBe(MIRROR);
        expect(withConfig('git push', { 'remote.origin.mirror': ['yes'] })).toBe(MIRROR);
        expect(withConfig('git push up ticket/01', { 'remote.up.mirror': ['1'] })).toBe(MIRROR);
        expect(withConfig('git push', { 'remote.up.mirror': ['on'], 'remote.pushDefault': ['up'] })).toBe(MIRROR);
      });

      it('leaves mirror off when it is false, or set on another remote', () => {
        expect(withConfig('git push origin', { 'remote.origin.mirror': ['true', 'false'] })).toBeUndefined();
        expect(withConfig('git push origin', { 'remote.origin.mirror': ['No'] })).toBeUndefined();
        expect(withConfig('git push origin', { 'remote.origin.mirror': ['OFF'] })).toBeUndefined();
        expect(withConfig('git push origin', { 'remote.origin.mirror': ['00'] })).toBeUndefined();
        expect(withConfig('git push origin', { 'remote.up.mirror': ['true'] })).toBeUndefined();
        expect(withConfig('git push origin', { 'remote.origin.mirror': ['xfalse'] })).toBe(MIRROR);
        expect(withConfig('git push origin', { 'remote.origin.mirror': ['falsey'] })).toBe(MIRROR);
      });

      it('blocks remote.origin.push=:, which pushes every matching branch, main too', () => {
        expect(withConfig('git push', { 'remote.origin.push': [':'] })).toBe(toMain('*'));
        expect(withConfig('git push origin', { 'remote.origin.push': ['HEAD:ticket/01', ':'] })).toBe(toMain('*'));
      });

      it('blocks a configured refspec with +, a forced update, +: included', () => {
        expect(withConfig('git push origin', { 'remote.origin.push': ['+:'] })).toBe(FORCE);
        expect(withConfig('git push', { 'remote.origin.push': ['+HEAD:ticket/01'] })).toBe(FORCE);
        expect(withConfig('git push origin ticket/01:ticket/01', { 'remote.origin.push': ['+refs/heads/x:refs/heads/x'] })).toBe(FORCE);
        expect(withConfig('git push origin', { 'remote.up.push': ['+HEAD:ticket/01'] })).toBeUndefined();
      });

      it('counts a configured wildcard refspec as reaching main, for a refspec without :<dst> too', () => {
        // refs/heads/x*:refs/heads/ma* sends xin to main; the guard does not work the glob out.
        expect(withConfig('git push origin xin', { 'remote.origin.push': ['refs/heads/x*:refs/heads/ma*'] }, 'xin')).toBe(toMain('refs/heads/ma*'));
        expect(withConfig('git push origin', { 'remote.origin.push': ['refs/heads/*:refs/heads/*'] })).toBe(toMain('refs/heads/*'));
      });
    });

    it('pushes a branch named like main (heads/main) to that name, with no config at all', () => {
      expect(check('git push', 'heads/main')).toBe(toMain('heads/main'));
      expect(check('git push origin', 'refs/heads/master')).toBe(toMain('refs/heads/master'));
    });

    it('takes the remote from pushRemote, then remote.pushDefault, then the branch remote, then origin', () => {
      const up = { 'remote.up.push': ['HEAD:main'] };
      expect(withConfig('git push', { ...up, 'branch.ticket/01.pushRemote': ['up'] })).toBe(toMain('main'));
      expect(withConfig('git push', { ...up, 'remote.pushDefault': ['up'] })).toBe(toMain('main'));
      expect(withConfig('git push', { ...up, 'branch.ticket/01.remote': ['up'] })).toBe(toMain('main'));
      expect(withConfig('git push', { ...up, 'remote.pushDefault': ['x', 'up'] })).toBe(toMain('main'));
      expect(withConfig('git push', up)).toBeUndefined();
    });

    it('follows push.default: upstream pushes to the branch it tracks, matching pushes main too', () => {
      const tracks = { 'branch.ticket/01.merge': ['refs/heads/main'] };
      expect(withConfig('git push', { ...tracks, 'push.default': ['upstream'] })).toBe(toMain('refs/heads/main'));
      expect(withConfig('git push origin', { ...tracks, 'push.default': ['tracking'] })).toBe(toMain('refs/heads/main'));
      expect(withConfig('git push', { ...tracks, 'push.default': ['upstream', 'simple'] })).toBeUndefined();
      expect(withConfig('git push', { 'push.default': ['matching'] })).toBe(toMain('*'));
      // simple (the default) refuses a branch whose upstream has another name; current pushes the branch itself.
      expect(withConfig('git push', tracks)).toBeUndefined();
      expect(withConfig('git push', { ...tracks, 'push.default': ['current'] })).toBeUndefined();
      expect(withConfig('git push', { ...tracks, 'push.default': ['nothing'] })).toBeUndefined();
    });
  });

  it('blocks pushing HEAD or @ while on main, since that is main then', () => {
    expect(check('git push origin HEAD', 'main')).toBe(toMain('main'));
    expect(check('git push origin @', 'main')).toBe(toMain('main'));
    expect(check('git push origin main', 'main')).toBe(toMain('main'));
    expect(check('git push origin refs/heads/master:heads/master', 'master')).toBe(toMain('heads/master'));
    expect(check('git push -u origin HEAD', 'ticket/01')).toBeUndefined();
    expect(check('git push origin @', 'ticket/01')).toBeUndefined();
  });

  it('sees through wrappers and program paths', () => {
    expect(check(`sh -c "git push --force"`)).toBe(FORCE);
    expect(check('FOO=1 env git reset --hard')).toBe(RESET);
    expect(check('/usr/bin/git push --force')).toBe(FORCE);
    expect(check('GIT.EXE push --force')).toBe(FORCE);
  });

  it('does not treat a commit message that mentions --force as a force push', () => {
    expect(check('git commit -m "remove --force from the docs"')).toBeUndefined();
  });
});

describe('gh api: reads only (decision 33)', () => {
  const WRITE = 'gh api may only read; writing through the API is not allowed';
  const MUTATION = 'a GraphQL mutation, or a query read from a file or stdin, may write; gh api may only read';
  const UNREAD = MUTATION;

  it.each([
    'gh api repos/o/r/pulls/12',
    'gh api -X GET repos/o/r/commits',
    'gh api --method get repos/o/r',
    'gh api --method=GET repos/o/r',
    'gh api -XGET repos/o/r',
    'gh api repos/o/r/issues -H "Accept: application/json" --jq .[].title',
    'gh api --paginate repos/o/r/issues -q .[].number',
    "gh api graphql -f 'query=query { viewer { login } }'",
    "gh api graphql -f query='{ repository(owner: \"o\", name: \"r\") { id } }' -F n=3",
    "gh api graphql --raw-field 'query=query Q { viewer { login } }' --field n=1",
    "gh api graphql -f 'query=query { viewer { login } }' -X POST",
    "gh api graphql -f 'query=query { viewer { login } }' --method=get",
    'gh api repos/o/self-fix/issues',
    "gh api graphql -f 'query=query { repo { mutationCount } }'",
    "gh api graphql -f 'query=query { premutation }'",
    'gh api graphql -f query=q--input',
    'gh api repos/o/my-Xrepo',
    'gh api repos/o/r --paginate --slurp',
    'gh release create v1 -F notes.md',
    'gh issue create --title x --body-file b.md',
  ])('allows %s', (line) => {
    expect(check(line)).toBeUndefined();
  });

  it.each([
    ['gh api -X POST repos/o/r/issues', WRITE],
    ['gh api -X PATCH repos/o/r/git/refs/heads/main', WRITE],
    ['gh api -XPUT repos/o/r/contents/x', WRITE],
    ['gh api --method DELETE repos/o/r/git/refs/heads/x', WRITE],
    ['gh api --method=put repos/o/r/contents/x', WRITE],
    ['gh api repos/o/r/merges -f base=main -f head=x', WRITE],
    ['gh api repos/o/r/issues -F title=x', WRITE],
    ['gh api repos/o/r/issues -Ftitle=x', WRITE],
    ['gh api repos/o/r/issues -ftitle=x', WRITE],
    ['gh api repos/o/r/issues --field title=x', WRITE],
    ['gh api repos/o/r/issues --field=title=x', WRITE],
    ['gh api repos/o/r/issues --raw-field title=x', WRITE],
    ['gh api repos/o/r/issues --raw-field=title=x', WRITE],
    ['gh api repos/o/r/issues --input body.json', WRITE],
    ['gh api repos/o/r/issues --input=body.json', WRITE],
    ['gh api -iX POST repos/o/r/issues', WRITE],
    ['gh api -iXPOST repos/o/r/issues', WRITE],
    ['gh api repos/o/r/issues -if title=x', WRITE],
    ['gh api repos/o/r/issues -X', WRITE],
    ['gh api -X POST graphql', WRITE],
    ['gh api graphql -X PATCH', WRITE],
    ['gh api graphql -XGETS', WRITE],
    ['gh api graphql -X XPOST', WRITE],
    ['gh api repos/o/r -X GETX', WRITE],
    ['gh api repos/o/r -XPOSTGET', WRITE],
    ['gh api graphql -f query=x -F q=@-', UNREAD],
    ["gh api graphql -f 'query=query { a } mutation { b }'", MUTATION],
    ['gh api -X GET repos/o/r/issues --input body.json', WRITE],
    ["gh api graphql -f 'query=mutation { addComment(input: {}) { clientMutationId } }'", MUTATION],
    ["gh api graphql -f 'query=MUTATION{x}'", MUTATION],
    ['gh api graphql -F query=@q.graphql', UNREAD],
    ['gh api graphql --input q.json', UNREAD],
    ["gh api graphql -f 'query=query { viewer { login } }' -X DELETE", WRITE],
  ])('refuses %s', (line, reason) => {
    expect(check(line)).toBe(reason);
  });

  it('sees through wrappers and program paths', () => {
    expect(check('sh -c "/usr/bin/gh api -X POST repos/o/r/issues"')).toBe(WRITE);
    expect(check("C:/gh/GH.EXE api --method PATCH x")).toBe(WRITE);
  });
});

describe('hookEnvReason: env that turns the git hooks off (decision 34)', () => {
  const reason = (line: string, dialect: 'sh' | 'powershell' | 'cmd' = 'sh') => hookEnvReason(readLine(line, dialect).words);

  it.each([
    ['HUSKY=0 git commit -m x', 'HUSKY=0'],
    ['husky=0 git commit', 'husky=0'],
    ['LEFTHOOK=0 git commit', 'LEFTHOOK=0'],
    ['SKIP=eslint git commit', 'SKIP=eslint'],
    ['ECC_SKIP_PRECOMMIT=1 git commit', 'ECC_SKIP_PRECOMMIT=1'],
    ['HUSKY_SKIP_HOOKS=1 git commit', 'HUSKY_SKIP_HOOKS=1'],
    ['SKIP_HOOKS=1 git commit', 'SKIP_HOOKS=1'],
    ['GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=x GIT_CONFIG_VALUE_0=y git commit', 'GIT_CONFIG_COUNT=1'],
    ['GIT_CONFIG_PARAMETERS=x git commit', 'GIT_CONFIG_PARAMETERS=x'],
    ['GIT_CONFIG_GLOBAL=/tmp/g git commit', 'GIT_CONFIG_GLOBAL=/tmp/g'],
    ['GIT_CONFIG=/tmp/g git commit', 'GIT_CONFIG=/tmp/g'],
    ['NO_VERIFY=1 git commit', 'NO_VERIFY=1'],
    ['GIT_NO_VERIFY=1 git commit', 'GIT_NO_VERIFY=1'],
    ['env HUSKY=0 git commit', 'HUSKY=0'],
    ['export HUSKY=0; git commit', 'HUSKY=0'],
    ["sh -c 'HUSKY=0 git commit'", 'HUSKY=0 git commit'],
    ['echo $(HUSKY=0 git commit)', 'HUSKY=0'],
    ['A=1 HUSKY=0 git commit', 'HUSKY=0'],
    ['git -c core.hooksPath=/dev/null commit', 'core.hooksPath=/dev/null'],
    ['export X=core.hooksPath', 'X=core.hooksPath'],
    ['echo CORE.HOOKSPATH', 'CORE.HOOKSPATH'],
  ])('refuses %s', (line, word) => {
    expect(reason(line)).toBe(`${word} can turn the git hooks off; agents never set it`);
  });

  it.each([
    ['$env:HUSKY=0; git commit', '$env:HUSKY=0'],
    ["$env:HUSKY = '0'", '$env:HUSKY'],
    ['Set-Item env:SKIP lint', 'env:SKIP'],
    ['Remove-Item Env:GIT_CONFIG_NOSYSTEM', 'Env:GIT_CONFIG_NOSYSTEM'],
  ])('refuses the PowerShell %s', (line, word) => {
    expect(reason(line, 'powershell')).toBe(`${word} can turn the git hooks off; agents never set it`);
  });

  it('refuses cmd set', () => {
    expect(reason('set HUSKY=0 && git commit', 'cmd')).toBe('HUSKY=0 can turn the git hooks off; agents never set it');
  });

  it.each([
    'git commit -m skip',
    'git commit -m "skip the slow test"',
    'echo HUSKY',
    'npm test -- --skip=x',
    'NODE_ENV=test npm test',
    'GIT_AUTHOR_NAME=x git commit',
    'git config --get core.editor',
    'echo $env:HOME',
    'MYGIT_CONFIG=1 npm test',
    'XHUSKY=1 npm test',
    'HUSKYX=1 npm test',
    'env:PATH',
    'A=env:HUSKY',
  ])('allows %s', (line) => {
    expect(reason(line)).toBeUndefined();
  });
});
