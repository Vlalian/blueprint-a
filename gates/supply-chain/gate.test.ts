import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { supplyChainGate, supplyChainScan, type SupplyChainIo } from './gate.ts';

const ROOT = resolve(import.meta.dirname, '../..');

const lock = (packages: Record<string, object>) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...packages } });
const ALLOW = JSON.stringify({ licenceExceptions: {}, installScripts: { fsevents: 'macOS watcher' } });
const BASE = lock({ 'node_modules/a': { version: '1.0.0', license: 'MIT' } });

function fakeIo(files: Record<string, string>, refs: Record<string, Record<string, string>> = {}) {
  const calls: string[][] = [];
  const io: SupplyChainIo & { write(path: string, text: string): void } = {
    readFile: (path) => files[path],
    git: (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return { status: args[3].replace('^{commit}', '') in refs ? 0 : 1, stdout: '' };
      const [ref, path] = args[1].split(':');
      const text = refs[ref]?.[path];
      return text === undefined ? { status: 128, stdout: '' } : { status: 0, stdout: text };
    },
    write: (path, text) => void (files[path] = text),
  };
  return { io, calls, files };
}

describe('supplyChainGate', () => {
  it('passes when the lockfile adds a permissive package, and lists what changed', () => {
    const head = lock({ 'node_modules/a': { version: '1.0.0', license: 'MIT' }, 'node_modules/b': { version: '2.0.0', license: 'ISC' } });
    const { io, calls } = fakeIo({ 'package-lock.json': head, 'config/supply-chain.json': ALLOW }, { main: { 'package-lock.json': BASE } });
    expect(supplyChainGate({ base: 'main' }, io)).toEqual({ gate: 'supply-chain', pass: true, changed: ['b@2.0.0'], findings: [] });
    expect(calls).toEqual([
      ['rev-parse', '--verify', '--quiet', 'main^{commit}'],
      ['show', 'main:package-lock.json'],
    ]);
  });

  it('fails on a new copyleft package and on an install script from an unknown package', () => {
    const head = lock({ 'node_modules/gpl': { version: '1.0.0', license: 'GPL-3.0' }, 'node_modules/evil': { version: '6.6.6', license: 'MIT', hasInstallScript: true } });
    const { io } = fakeIo({ 'lock.json': head, 'allow.json': ALLOW }, { HEAD: { 'lock.json': BASE } });
    const r = supplyChainGate({ base: 'HEAD', lockfile: 'lock.json', allowlist: 'allow.json' }, io);
    expect(r.pass).toBe(false);
    expect(r.changed).toEqual(['gpl@1.0.0', 'evil@6.6.6']);
    expect(r.findings).toEqual([
      expect.stringMatching(/^gpl@1\.0\.0: licence "GPL-3\.0" is not on the allowlist/),
      'evil@6.6.6: runs an install script and is not on the install-script allowlist',
    ]);
  });

  it('treats every package as new when the base commit has no lockfile', () => {
    const { io } = fakeIo({ 'package-lock.json': BASE, 'config/supply-chain.json': ALLOW }, { main: {} });
    expect(supplyChainGate({ base: 'main' }, io).changed).toEqual(['a@1.0.0']);
  });

  it('compares against a saved lockfile with --base-file, and against nothing when that file is missing', () => {
    const head = lock({ 'node_modules/a': { version: '1.0.1', license: 'MIT' } });
    const { io, calls } = fakeIo({ 'package-lock.json': head, 'last.json': BASE, 'config/supply-chain.json': ALLOW });
    expect(supplyChainGate({ 'base-file': 'last.json' }, io).changed).toEqual(['a@1.0.1']);
    expect(supplyChainGate({ 'base-file': 'none.json' }, io).changed).toEqual(['a@1.0.1']);
    expect(calls).toEqual([]);
  });

  it('cannot run without a base, with an unknown ref, a ref that looks like an option, or a missing lockfile or allowlist', () => {
    const { io } = fakeIo({ 'package-lock.json': BASE, 'config/supply-chain.json': ALLOW }, { main: {} });
    expect(() => supplyChainGate({}, io)).toThrow(/^usage: supply-chain --base <ref> \| --base-file <lockfile>/);
    expect(() => supplyChainGate({ base: 'nope' }, io)).toThrow('unknown git ref: nope');
    expect(() => supplyChainGate({ base: '--output=x' }, io)).toThrow('not a git ref: --output=x');
    expect(() => supplyChainGate({ base: 'main', lockfile: 'gone.json' }, io)).toThrow('no lockfile at gone.json');
    expect(() => supplyChainGate({ base: 'main', allowlist: 'gone.json' }, io)).toThrow('no allowlist at gone.json');
  });
});

describe('supplyChainScan: once per run, against the lockfile the last clean scan saw', () => {
  const paths = { lockfile: 'package-lock.json', baseline: 'state/supply-chain/package-lock.json', allowlist: 'config/supply-chain.json' };

  it('saves the lockfile as the new baseline after a clean scan', () => {
    const { io, files } = fakeIo({ 'package-lock.json': BASE, 'config/supply-chain.json': ALLOW });
    expect(supplyChainScan(paths, io)).toEqual({ gate: 'supply-chain', pass: true, changed: ['a@1.0.0'], findings: [] });
    expect(files['state/supply-chain/package-lock.json']).toBe(BASE);
    expect(supplyChainScan(paths, io).changed).toEqual([]);
  });

  it('keeps the old baseline after a failed scan, so the next run flags the package again', () => {
    const bad = lock({ 'node_modules/gpl': { version: '1.0.0', license: 'GPL-3.0' } });
    const { io, files } = fakeIo({ 'package-lock.json': bad, 'config/supply-chain.json': ALLOW, 'state/supply-chain/package-lock.json': BASE });
    expect(supplyChainScan(paths, io).pass).toBe(false);
    expect(files['state/supply-chain/package-lock.json']).toBe(BASE);
  });

  it('turns a scan that cannot run into a failed result, never a pass', () => {
    const { io, files } = fakeIo({ 'config/supply-chain.json': ALLOW });
    expect(supplyChainScan(paths, io)).toEqual({ gate: 'supply-chain', pass: false, error: 'no lockfile at package-lock.json' });
    expect(files['state/supply-chain/package-lock.json']).toBeUndefined();
  });

  it("passes this repo's own lockfile from scratch with the shipped allowlist", () => {
    const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
    const { io } = fakeIo({ 'package-lock.json': read('package-lock.json'), 'config/supply-chain.json': read('config/supply-chain.json') });
    expect(supplyChainScan(paths, io)).toMatchObject({ pass: true, findings: [] });
  });
});
