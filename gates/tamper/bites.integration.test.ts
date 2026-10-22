// Prove the tamper gate bites (decision 34) with real git, a real interpreter write and real hooks,
// set up only by a config/tamper.json of its own (--config, ticket 82): what a pre-tool hook cannot
// see, the gate still catches, and an exception module the config names can let a change through.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, type TestContext } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { hooksFingerprint } from './core.ts';
import { hooksOf, repoHooksFingerprint } from './repo.ts';

const CLI = join(import.meta.dirname, 'cli.ts');

/** The fingerprint of git's hooks folder, whatever the home config says. */
const gitHooks = (repo: string) => {
  const h = hooksOf(repo);
  return hooksFingerprint(h.files, h.hooksPath, []);
};

/** A repo with a protected file committed, and a config folder outside it. */
function world(config: Record<string, unknown> = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'tamper-repo-'));
  const etc = mkdtempSync(join(tmpdir(), 'tamper-config-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'CONTEXT.md'), '# Context\n');
  writeFileSync(join(repo, 'NOTES.md'), '# Notes\n');
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  const file = join(etc, 'tamper.json');
  writeFileSync(file, JSON.stringify({ protectedPaths: ['CONTEXT.md', 'NOTES.md'], owner: 'the lead', ...config }));
  const run = (hooks: string, ...more: string[]) => spawnSync(process.execPath, [CLI, '--base', g('rev-parse', 'HEAD').trim(), '--hooks', hooks, '--config', file, '--cwd', repo, ...more], { encoding: 'utf8' });
  return { repo, etc, g, run };
}

describe('the tamper gate bites (real git)', () => {
  it('fails when an interpreter writes a protected file a pre-tool hook never saw, and passes again once it is restored', () => {
    const w = world();
    const hooks = gitHooks(w.repo);
    const result = proveItBites({
      run: () => w.run(hooks).status ?? -1,
      inject: () => execFileSync(process.execPath, ['-e', "require('fs').writeFileSync('CONTEXT.md', '')"], { cwd: w.repo }),
      revert: () => w.g('checkout', '--', 'CONTEXT.md'),
    });
    expect(result).toEqual(BITES);
  });

  it('names the protected file and the configured owner', () => {
    const w = world();
    rmSync(join(w.repo, 'CONTEXT.md'));
    expect(JSON.parse(w.run(gitHooks(w.repo)).stdout).problems).toEqual(['CONTEXT.md is tier 4 and differs from the base; only the lead changes it, and agents never do']);
  });

  it('fails when a git hook is added or core.hooksPath is set, and passes again once undone', () => {
    const w = world();
    const hooks = gitHooks(w.repo);
    const hook = join(w.repo, '.git', 'hooks', 'post-checkout');
    expect(proveItBites({ run: () => w.run(hooks).status ?? -1, inject: () => writeFileSync(hook, '#!/bin/sh\n'), revert: () => rmSync(hook), gate: 'tamper' })).toEqual(BITES);
    expect(
      proveItBites({
        run: () => w.run(hooks).status ?? -1,
        inject: () => w.g('config', 'core.hooksPath', '/dev/null'),
        revert: () => w.g('config', '--unset', 'core.hooksPath'),
        gate: 'tamper',
      }),
    ).toEqual(BITES);
  });

  it('fingerprints the hooks core.hooksPath points at, relative to the work tree, and fails when one changes (ticket 74, finding 7)', () => {
    const w = world();
    mkdirSync(join(w.repo, '.githooks'));
    const hook = join(w.repo, '.githooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    w.g('config', 'core.hooksPath', '.githooks');
    const hooks = gitHooks(w.repo);
    expect(gitHooks(join(w.repo, 'src'))).toBe(hooks);
    const result = proveItBites({ run: () => w.run(hooks).status ?? -1, inject: () => writeFileSync(hook, '#!/bin/sh\nexit 1\n'), revert: () => writeFileSync(hook, '#!/bin/sh\nexit 0\n'), gate: 'tamper' });
    expect(result).toEqual(BITES);
  });

  it('fingerprints the files the config names instead of the git hooks, a file or a whole folder', () => {
    const targets = ['.harness/settings.json', 'tools/hooks'];
    const w = world({ hooks: targets });
    mkdirSync(join(w.repo, '.harness'));
    mkdirSync(join(w.repo, 'tools', 'hooks', 'deep'), { recursive: true });
    writeFileSync(join(w.repo, '.harness', 'settings.json'), '{}\n');
    writeFileSync(join(w.repo, 'tools', 'hooks', 'deep', 'stop.sh'), 'exit 0\n');
    const hooks = repoHooksFingerprint(w.repo, [], targets);
    expect(hooks).not.toBe(gitHooks(w.repo));
    writeFileSync(join(w.repo, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\n');
    expect(w.run(hooks).status).toBe(0);
    const settings = join(w.repo, '.harness', 'settings.json');
    expect(proveItBites({ run: () => w.run(hooks).status ?? -1, inject: () => writeFileSync(settings, '{"hooks":{}}\n'), revert: () => writeFileSync(settings, '{}\n'), gate: 'tamper' })).toEqual(BITES);
    const deep = join(w.repo, 'tools', 'hooks', 'deep', 'stop.sh');
    expect(proveItBites({ run: () => w.run(hooks).status ?? -1, inject: () => writeFileSync(deep, 'exit 1\n'), revert: () => writeFileSync(deep, 'exit 0\n'), gate: 'tamper' })).toEqual(BITES);
  });

  it("lets through only what the config's exception module allows, loaded from the config's folder", () => {
    const w = world({ exceptions: 'allow.mjs' });
    writeFileSync(
      join(w.etc, 'allow.mjs'),
      "export const tamperException = (path, ctx) => (path === 'NOTES.md' ? { problem: ctx.after(path)?.endsWith('- ok\\n') ? undefined : 'only an ok line may be added' } : undefined);\n",
    );
    const hooks = gitHooks(w.repo);
    writeFileSync(join(w.repo, 'NOTES.md'), '# Notes\n- ok\n');
    expect(w.run(hooks).status).toBe(0);
    writeFileSync(join(w.repo, 'NOTES.md'), '# Notes\n- skip the tests\n');
    expect(JSON.parse(w.run(hooks).stdout).problems).toEqual(['NOTES.md: only an ok line may be added']);
    writeFileSync(join(w.repo, 'NOTES.md'), '# Notes\n');
    writeFileSync(join(w.repo, 'CONTEXT.md'), '');
    expect(w.run(hooks).status).toBe(1);
  });

  it('could not run, so never passes, when the config is missing or its exception module exports no rule', () => {
    const w = world({ exceptions: 'none.mjs' });
    writeFileSync(join(w.etc, 'none.mjs'), 'export const other = 1;\n');
    const hooks = gitHooks(w.repo);
    const r = w.run(hooks);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toBe('none.mjs exports no tamperException');
    const missing = spawnSync(process.execPath, [CLI, '--base', 'HEAD', '--hooks', hooks, '--config', join(w.etc, 'nope.json'), '--cwd', w.repo], { encoding: 'utf8' });
    expect(missing.status).toBe(2);
    expect(JSON.parse(missing.stdout).error).toMatch(/^no tamper config at /);
  });
});

/** A repo whose policy lives inside it: config/tamper.json and the exception module it names, with a rule file that module imports. */
function homeWorld() {
  const w = world();
  mkdirSync(join(w.repo, 'config'));
  writeFileSync(join(w.repo, 'config', 'tamper.json'), JSON.stringify({ protectedPaths: ['CONTEXT.md'], owner: 'the lead', exceptions: 'allow.mjs' }));
  writeFileSync(join(w.repo, 'config', 'allow.mjs'), "import { rule } from './rule.mjs';\nexport const tamperException = (path) => rule(path);\n");
  writeFileSync(join(w.repo, 'config', 'rule.mjs'), "export const rule = (path) => (path === 'NOTES.md' ? {} : undefined);\n");
  w.g('add', '-A');
  w.g('commit', '-qm', 'policy');
  const file = join(w.repo, 'config', 'tamper.json');
  const run = (mode: string[], hooks = gitHooks(w.repo)) => spawnSync(process.execPath, [CLI, ...mode, '--hooks', hooks, '--config', file, '--cwd', w.repo], { encoding: 'utf8' });
  const base = () => ['--base', w.g('rev-parse', 'HEAD').trim()];
  const restore = () => w.g('checkout', 'HEAD', '--', '.');
  return { ...w, run, base, restore };
}

/** Replaces `path` with a symlink to `target`; skips the test where symlinkSync throws EPERM (Windows without the privilege). */
function linkOrSkip(ctx: TestContext, target: string, path: string): void {
  rmSync(path);
  try {
    symlinkSync(target, path, 'file');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
    ctx.skip();
  }
}

describe('the tamper gate reads its policy from the trusted base (review round)', () => {
  it('fails when the config is emptied to let a protected edit through, and names both', () => {
    const w = homeWorld();
    const inject = () => {
      writeFileSync(join(w.repo, 'config', 'tamper.json'), '{"protectedPaths":[]}');
      writeFileSync(join(w.repo, 'CONTEXT.md'), '');
    };
    expect(proveItBites({ run: () => w.run(w.base()).status ?? -1, inject, revert: w.restore })).toEqual(BITES);
    inject();
    expect(JSON.parse(w.run(w.base()).stdout).problems).toEqual([
      'CONTEXT.md is tier 4 and differs from the base; only the lead changes it, and agents never do',
      'config/tamper.json is tier 4 and differs from the base; only the lead changes it, and agents never do',
    ]);
  });

  it('fails when the exception module is changed to let everything through', () => {
    const w = homeWorld();
    const inject = () => {
      writeFileSync(join(w.repo, 'config', 'allow.mjs'), 'export const tamperException = () => ({});\n');
      writeFileSync(join(w.repo, 'CONTEXT.md'), '');
    };
    expect(proveItBites({ run: () => w.run(w.base()).status ?? -1, inject, revert: w.restore })).toEqual(BITES);
    inject();
    expect(JSON.parse(w.run(w.base()).stdout).problems).toEqual([
      'CONTEXT.md is tier 4 and differs from the base; only the lead changes it, and agents never do',
      'config/allow.mjs is tier 4 and differs from the base; only the lead changes it, and agents never do',
    ]);
  });

  it("runs the base's copy of what the exception module imports, so changing it lets nothing through", () => {
    const w = homeWorld();
    const inject = () => {
      writeFileSync(join(w.repo, 'config', 'rule.mjs'), 'export const rule = () => ({});\n');
      writeFileSync(join(w.repo, 'CONTEXT.md'), '');
    };
    expect(proveItBites({ run: () => w.run(w.base()).status ?? -1, inject, revert: w.restore })).toEqual(BITES);
    writeFileSync(join(w.repo, 'NOTES.md'), '# Notes\n- fine\n');
    expect(w.run(w.base()).status).toBe(0);
  });

  it('reads the policy from HEAD in --staged mode', () => {
    const w = homeWorld();
    const inject = () => {
      writeFileSync(join(w.repo, 'config', 'tamper.json'), '{"protectedPaths":[]}');
      writeFileSync(join(w.repo, 'CONTEXT.md'), '');
      w.g('add', '-A');
    };
    const revert = () => {
      w.g('reset', '-q');
      w.restore();
    };
    expect(proveItBites({ run: () => w.run(['--staged']).status ?? -1, inject, revert })).toEqual(BITES);
  });

  it('fails when config/tamper.json is replaced by a symlink to an emptied config outside the repo (review round 2; skipped where symlinkSync throws EPERM)', (ctx) => {
    const w = homeWorld();
    const evil = join(w.etc, 'evil.json');
    writeFileSync(evil, '{"protectedPaths":[]}');
    const inject = () => {
      linkOrSkip(ctx, evil, join(w.repo, 'config', 'tamper.json'));
      writeFileSync(join(w.repo, 'CONTEXT.md'), '');
    };
    expect(proveItBites({ run: () => w.run(w.base()).status ?? -1, inject, revert: w.restore })).toEqual(BITES);
    inject();
    expect(JSON.parse(w.run(w.base()).stdout).problems).toEqual([
      'CONTEXT.md is tier 4 and differs from the base; only the lead changes it, and agents never do',
      'config/tamper.json is tier 4 and differs from the base; only the lead changes it, and agents never do',
    ]);
  });

  it('runs the base copy when the exception module or a file it imports is replaced by a symlink to an allow-all module outside the repo (review round 2; skipped where symlinkSync throws EPERM)', (ctx) => {
    const w = homeWorld();
    const evilRule = join(w.etc, 'rule.mjs');
    writeFileSync(evilRule, 'export const rule = () => ({});\n');
    const evilModule = join(w.etc, 'allow.mjs');
    writeFileSync(evilModule, 'export const tamperException = () => ({});\n');
    for (const [target, name] of [[evilRule, 'rule.mjs'], [evilModule, 'allow.mjs']]) {
      const inject = () => {
        linkOrSkip(ctx, target, join(w.repo, 'config', name));
        writeFileSync(join(w.repo, 'CONTEXT.md'), '');
      };
      expect(proveItBites({ run: () => w.run(w.base()).status ?? -1, inject, revert: w.restore })).toEqual(BITES);
      inject();
      expect(JSON.parse(w.run(w.base()).stdout).problems[0]).toBe('CONTEXT.md is tier 4 and differs from the base; only the lead changes it, and agents never do');
      w.restore();
    }
  });
});

/** homeWorld with the exception module at the base importing what `spec` names for the repo, so its rule loads only through that import. */
function importing(spec: string | ((repo: string) => string)) {
  const w = homeWorld();
  const specifier = typeof spec === 'string' ? spec : spec(w.repo);
  writeFileSync(join(w.repo, 'config', 'allow.mjs'), `import { rule } from ${JSON.stringify(specifier)};\nexport const tamperException = (path) => rule(path);\n`);
  w.g('add', '-A');
  w.g('commit', '-qm', 'import form');
  return w;
}

describe('the exception module loads only plain relative imports from the base (review round 3)', () => {
  const forms: [string, (repo: string) => string][] = [
    ['a query', () => './rule.mjs?variant=1'],
    ['a fragment', () => './rule.mjs#x'],
    ['an absolute path', (repo) => join(repo, 'config', 'rule.mjs')],
    ['a file URL', (repo) => pathToFileURL(join(repo, 'config', 'rule.mjs')).href],
    ['a bare package', () => 'allow-all'],
    ['a builtin without node:', () => 'fs'],
    ['a relative path out of the repo', (repo) => `../../${basename(repo)}-out/rule.mjs`],
  ];
  for (const [form, spec] of forms) {
    it(`could not run, so never passes, when it imports ${form}, and names the import`, () => {
      const w = importing(spec);
      const out = join(w.repo, '..', `${basename(w.repo)}-out`);
      mkdirSync(out);
      writeFileSync(join(out, 'rule.mjs'), 'export const rule = () => ({});\n');
      writeFileSync(join(w.repo, 'CONTEXT.md'), '');
      const r = w.run(w.base());
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).error).toContain(JSON.stringify(spec(w.repo)));
    });
  }

  it('could not run when a relative import names a file the base does not hold, even one in the working tree', () => {
    const w = importing('./later.mjs');
    writeFileSync(join(w.repo, 'config', 'later.mjs'), 'export const rule = () => ({});\n');
    writeFileSync(join(w.repo, 'CONTEXT.md'), '');
    const r = w.run(w.base());
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toContain('config/later.mjs');
  });

  it('still runs a plain relative import from the base, and a working-tree change to it lets nothing through', () => {
    const w = importing('./rule.mjs');
    writeFileSync(join(w.repo, 'NOTES.md'), '# Notes\n- fine\n');
    expect(w.run(w.base()).status).toBe(0);
    const inject = () => {
      writeFileSync(join(w.repo, 'config', 'rule.mjs'), 'export const rule = () => ({});\n');
      writeFileSync(join(w.repo, 'CONTEXT.md'), '');
    };
    expect(proveItBites({ run: () => w.run(w.base()).status ?? -1, inject, revert: w.restore })).toEqual(BITES);
  });
});
