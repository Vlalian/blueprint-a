import { describe, expect, it } from 'vitest';
import { changedPackages, lockPackages, parseAllowlist, supplyChainFindings, type Allowlist } from './core.ts';

const lock = (packages: Record<string, object>) => JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' }, ...packages } });

const ALLOW: Allowlist = {
  licenceExceptions: { 'caniuse-lite': 'CC-BY-4.0 data, no code', 'lightningcss*': 'MPL-2.0, used unmodified' },
  installScripts: { fsevents: 'macOS file watcher' },
};

describe('lockPackages', () => {
  it('reads each installed package with its name, version, licence and install-script flag', () => {
    const text = lock({
      'node_modules/a': { version: '1.0.0', license: 'MIT' },
      'node_modules/@s/b': { version: '2.0.0', license: 'ISC', hasInstallScript: true },
      'node_modules/a/node_modules/c': { version: '3.0.0' },
      'node_modules/alias': { name: 'real-name', version: '4.0.0', license: 'MIT' },
      'packages/local': { version: '0.0.1' },
      'node_modules/local': { resolved: 'packages/local', link: true },
    });
    expect(lockPackages(text)).toEqual(
      new Map([
        ['node_modules/a', { name: 'a', version: '1.0.0', license: 'MIT', installScript: false }],
        ['node_modules/@s/b', { name: '@s/b', version: '2.0.0', license: 'ISC', installScript: true }],
        ['node_modules/a/node_modules/c', { name: 'c', version: '3.0.0', license: undefined, installScript: false }],
        ['node_modules/alias', { name: 'real-name', version: '4.0.0', license: 'MIT', installScript: false }],
      ]),
    );
  });

  it('refuses a lockfile without a packages map (npm 6 and older), rather than seeing no packages', () => {
    expect(() => lockPackages(JSON.stringify({ lockfileVersion: 1, dependencies: {} }))).toThrow(
      'package-lock.json has no "packages" map (lockfile version 2 or later is needed)',
    );
  });
});

describe('changedPackages', () => {
  const base = lockPackages(lock({ 'node_modules/a': { version: '1.0.0', license: 'MIT' }, 'node_modules/b': { version: '1.0.0', license: 'MIT' } }));

  it('lists packages that are new or changed version, licence or install script; not removed or unchanged ones', () => {
    const head = lockPackages(
      lock({
        'node_modules/a': { version: '1.0.0', license: 'MIT' },
        'node_modules/c': { version: '1.0.0', license: 'MIT' },
        'node_modules/d/node_modules/a': { version: '1.0.0', license: 'MIT' },
      }),
    );
    expect(changedPackages(base, head).map((p) => p.name)).toEqual(['c', 'a']);
    const bumped = lockPackages(lock({ 'node_modules/a': { version: '1.0.1', license: 'MIT' }, 'node_modules/b': { version: '1.0.0', license: 'GPL-3.0' } }));
    expect(changedPackages(base, bumped).map((p) => `${p.name}@${p.version}`)).toEqual(['a@1.0.1', 'b@1.0.0']);
    const scripted = lockPackages(lock({ 'node_modules/a': { version: '1.0.0', license: 'MIT', hasInstallScript: true } }));
    expect(changedPackages(base, scripted).map((p) => p.name)).toEqual(['a']);
    expect(changedPackages(base, base)).toEqual([]);
  });

  it('treats every package as new when there is no base lockfile', () => {
    expect(changedPackages(new Map(), base).map((p) => p.name)).toEqual(['a', 'b']);
  });
});

describe('supplyChainFindings', () => {
  const pkg = (name: string, license: string | undefined, installScript = false) => ({ name, version: '1.0.0', license, installScript });

  it('passes permissive licences and allowlisted exceptions, by exact name or prefix*', () => {
    expect(supplyChainFindings([pkg('a', 'MIT'), pkg('b', '(MIT OR GPL-3.0)'), pkg('caniuse-lite', 'CC-BY-4.0'), pkg('lightningcss-linux-x64-gnu', 'MPL-2.0')], ALLOW)).toEqual([]);
  });

  it('refuses a licence off the allowlist and a package with none', () => {
    expect(supplyChainFindings([pkg('left-pad', 'GPL-3.0'), pkg('mystery', undefined), pkg('caniuse', 'CC-BY-4.0')], ALLOW)).toEqual([
      'left-pad@1.0.0: licence "GPL-3.0" is not on the allowlist (MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD) and the package has no exception',
      'mystery@1.0.0: no licence declared and the package has no exception',
      'caniuse@1.0.0: licence "CC-BY-4.0" is not on the allowlist (MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD) and the package has no exception',
    ]);
  });

  it('refuses an install script from a package not on the install-script allowlist', () => {
    expect(supplyChainFindings([pkg('fsevents', 'MIT', true), pkg('evil', 'MIT', true), pkg('fsevents-x', 'MIT', true)], ALLOW)).toEqual([
      'evil@1.0.0: runs an install script and is not on the install-script allowlist',
      'fsevents-x@1.0.0: runs an install script and is not on the install-script allowlist',
    ]);
  });

  it('reports both problems of one package', () => {
    expect(supplyChainFindings([pkg('bad', 'GPL-3.0', true)], ALLOW)).toHaveLength(2);
  });
});

describe('parseAllowlist', () => {
  it('reads both lists, each name with its reason', () => {
    expect(parseAllowlist(JSON.stringify(ALLOW))).toEqual(ALLOW);
  });

  it.each([
    ['not JSON', '{', /^config\/supply-chain\.json: /],
    ['a missing list', JSON.stringify({ licenceExceptions: {} }), 'config/supply-chain.json: installScripts must be an object of package name to reason'],
    ['a list that is an array', JSON.stringify({ licenceExceptions: [], installScripts: {} }), 'config/supply-chain.json: licenceExceptions must be an object of package name to reason'],
    ['a null list', JSON.stringify({ licenceExceptions: null, installScripts: {} }), 'config/supply-chain.json: licenceExceptions must be an object of package name to reason'],
    ['an entry without a reason', JSON.stringify({ licenceExceptions: {}, installScripts: { x: '  ' } }), 'config/supply-chain.json: installScripts.x needs a reason'],
    ['a reason that is not text', JSON.stringify({ licenceExceptions: { x: true }, installScripts: {} }), 'config/supply-chain.json: licenceExceptions.x needs a reason'],
  ])('fails closed on %s', (_label, text, error) => {
    expect(() => parseAllowlist(text)).toThrow(error);
  });
});
