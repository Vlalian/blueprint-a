import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPythonLockfile, parseAudit, pythonPackages, pythonSupplyChainGate, supplyChainFor, type PythonAuditIo } from './python.ts';

// pip-audit 2.10.1's `-f json` output for requests==2.19.0, idna==3.7 and a name PyPI does not know,
// each vulnerability's description cut short.
const AUDIT = readFileSync(join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'supply-chain', 'pip-audit.json'), 'utf8');

const UV_LOCK = `version = 1
requires-python = ">=3.10"

[[package]]
name = "app"
version = "0.1.0"
source = { editable = "." }
dependencies = [{ name = "requests" }]

[[package]]
name = "Requests"
version = "2.19.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "idna"
version = "3.7"
source = { registry = "https://pypi.org/simple" }
`;

const POETRY_LOCK = `[[package]]
name = "requests"
version = "2.19.0"
description = "HTTP"
optional = false

[[package]]
name = "local-lib"
version = "0.2.0"

[package.source]
type = "directory"
url = "../local-lib"

[metadata]
lock-version = "2.0"
`;

describe('isPythonLockfile', () => {
  it('knows uv.lock, poetry.lock, requirements files and pyproject.toml, in any folder', () => {
    for (const f of ['uv.lock', 'app/poetry.lock', 'requirements.txt', 'requirements-dev.txt', 'pyproject.toml', 'app\\requirements.dev.txt']) expect(isPythonLockfile(f)).toBe(true);
    for (const f of ['package-lock.json', 'requirements.in', 'Cargo.lock', 'pyproject.toml.bak', 'not-uv.lock', 'uvXlock', 'requirements/other.txt']) expect(isPythonLockfile(f)).toBe(false);
  });
});

describe('pythonPackages', () => {
  it("reads uv.lock's registry packages by normalised name, leaving the project itself out", () => {
    expect(pythonPackages('uv.lock', UV_LOCK)).toEqual({ pinned: [{ name: 'requests', version: '2.19.0' }, { name: 'idna', version: '3.7' }], unpinned: [] });
  });

  it("reads poetry.lock's packages, leaving a local directory package out", () => {
    expect(pythonPackages('poetry.lock', POETRY_LOCK).pinned).toEqual([{ name: 'requests', version: '2.19.0' }]);
  });

  it('retains only complete registry pins and keeps adjacent lockfile tables separate', () => {
    const lock = [
      'name = "header"', 'version = "9"',
      '[[package]]', 'name = "NoVersion"',
      '[[package]]', 'version = "2"',
      '[[package]]', 'name = "VIRTUAL"', 'version = "1"', 'source = { virtual = "." }',
      '[[package]]', 'name = "GitLib"', 'version = "2"', '[package.source]', 'type = "git"',
      '[[package]]', 'name = "Foo__bar.BAZ"', 'version = "4"',
      '[metadata]', 'type = "file"',
    ].join('\r\n');
    expect(pythonPackages('uv.lock', lock)).toEqual({ pinned: [{ name: 'foo-bar-baz', version: '4' }], unpinned: [] });
  });

  it('reads pinned requirement lines, with extras, markers, hashes and comments, and names the unpinned ones', () => {
    const text = ['# app', 'Requests[socks]==2.19.0 ; python_version >= "3.8" \\', '    --hash=sha256:abc', 'idna===3.7  # pinned', '-r base.txt', '--index-url https://x', 'flask>=2', 'django', ''].join('\n');
    expect(pythonPackages('requirements.txt', text)).toEqual({ pinned: [{ name: 'requests', version: '2.19.0' }, { name: 'idna', version: '3.7' }], unpinned: ['flask>=2', 'django'] });
  });

  it('preserves unpinned requirements with continuations and recognises whitespace around pins', () => {
    const text = [' A-b.c_d [x] == 1.2; marker', '   dep\\', 'path @ https://x/y#fragment', '   # comment', ''].join('\r\n');
    expect(pythonPackages('requirements-win.txt', text)).toEqual({
      pinned: [{ name: 'a-b-c-d', version: '1.2' }], unpinned: ['dep', 'path @ https://x/y#fragment'],
    });
  });
});

describe('parseAudit', () => {
  it('deduplicates advisories and fixes and preserves skipped packages without a vulnerability list', () => {
    expect(parseAudit(JSON.stringify({ dependencies: [
      { name: 'My__Tool.Core', version: '1', vulns: [
        { id: 'A', fix_versions: ['2', '3'] }, { id: 'A', fix_versions: ['3'] }, { id: 'B' },
      ] },
      { name: 'local', skip_reason: '  unavailable  ' },
    ] }))).toEqual({
      vulnerable: [{ name: 'my-tool-core', version: '1', ids: ['A', 'B'], fixes: ['2', '3'] }],
      notAudited: ['local: unavailable'],
    });
    expect(() => parseAudit('{}')).toThrow('pip-audit gave no JSON report: no "dependencies"');
  });
  it("gives each package's vulnerabilities once, and the packages pip-audit could not audit", () => {
    const audit = parseAudit(AUDIT);
    expect(audit.vulnerable.map((v) => [v.name, v.version, v.ids.length])).toEqual([['requests', '2.19.0', 5], ['idna', '3.7', 1]]);
    expect(audit.vulnerable[0]!.ids).toContain('PYSEC-2018-28');
    expect(audit.notAudited).toEqual(['not-a-real-pkg-xyz-123: Dependency not found on PyPI and could not be audited: not-a-real-pkg-xyz-123 (1.0)']);
  });

  it('cannot run on output that is not pip-audit JSON', () => {
    expect(() => parseAudit('ERROR: connection refused')).toThrow('pip-audit gave no JSON report');
    const long = 'x'.repeat(500);
    expect(() => parseAudit(`  ${long}extra\n`)).toThrow(new Error(`pip-audit gave no JSON report: ${long}`));
  });
});

/** A project whose lockfile is `head` and, at the base ref, `base`; pip-audit answers `audit`. */
function fakeIo(files: Record<string, string>, base: Record<string, string> = {}, audit: { status: number; stdout: string; stderr?: string } = { status: 1, stdout: AUDIT }) {
  const io: PythonAuditIo & { audits: string[][]; written: Record<string, string>; removed: string[] } = {
    audits: [],
    written: {},
    removed: [],
    readFile: (path) => files[path],
    git: (args) => {
      if (args[0] === 'rev-parse') return { status: args[3] === 'main^{commit}' ? 0 : 1, stdout: '' };
      const file = args[1]!.replace(/^main:/, '');
      return file in base ? { status: 0, stdout: base[file]! } : { status: 128, stdout: '' };
    },
    pipAudit: (args) => (io.audits.push(args), { stderr: '', ...audit }),
    tempDir: () => '/tmp/audit-1',
    write: (path, text) => {
      io.written[path] = text;
    },
    remove: (dir) => {
      io.removed.push(dir);
    },
  };
  return io;
}

describe('supplyChainFor', () => {
  it('sends a Python lockfile to pip-audit, and starts the Python I/O only then', () => {
    const io = fakeIo({ 'requirements.txt': 'six==1.17.0\n' }, {}, { status: 0, stdout: JSON.stringify({ dependencies: [], fixes: [] }) });
    let made = 0;
    const python = () => (made++, { pipAudit: io.pipAudit, tempDir: io.tempDir, write: io.write, remove: io.remove });
    expect(supplyChainFor({ lockfile: 'requirements.txt' }, io, python)).toMatchObject({ gate: 'supply-chain', pass: true, standing: [] });
    expect(made).toBe(1);
  });

  it('keeps an npm lockfile, and no lockfile at all, on the npm gate', () => {
    const npm = JSON.stringify({ lockfileVersion: 3, packages: { '': {} } });
    const io = fakeIo({ 'package-lock.json': npm, 'allow.json': JSON.stringify({ licenceExceptions: {}, installScripts: {} }) });
    const python = () => {
      throw new Error('no Python I/O for npm');
    };
    expect(supplyChainFor({ lockfile: 'package-lock.json', 'base-file': 'package-lock.json', allowlist: 'allow.json' }, io, python)).toMatchObject({ pass: true, changed: [] });
    expect(() => supplyChainFor({}, io, python)).toThrow(/^usage: supply-chain/);
  });
});

describe('pythonSupplyChainGate', () => {
  it('uses the default lockfile and reports fixed and unfixed advisories', () => {
    const stdout = JSON.stringify({ dependencies: [
      { name: 'Requests', version: '2.19.0', vulns: [{ id: 'A', fix_versions: ['3', '4'] }, { id: 'B' }] },
      { name: 'idna', version: '3.7', vulns: [{ id: 'C' }] },
    ] });
    expect(pythonSupplyChainGate({}, fakeIo({ 'uv.lock': UV_LOCK }, {}, { status: 1, stdout }))).toEqual({
      gate: 'supply-chain', pass: false, changed: ['requests@2.19.0', 'idna@3.7'],
      findings: [
        'requests@2.19.0: known vulnerabilities A, B (fixed in 3, 4)',
        'idna@3.7: known vulnerabilities C, no fixed version yet',
      ],
      standing: [], notAudited: [],
    });
  });

  it('passes a clean whole-project audit without reporting unpinned requirements', () => {
    expect(pythonSupplyChainGate({ lockfile: 'pyproject.toml' }, fakeIo(
      { 'pyproject.toml': '[project]' }, {}, { status: 0, stdout: '{"dependencies":[]}' },
    ))).toStrictEqual({ gate: 'supply-chain', pass: true, findings: [], standing: [], notAudited: [] });
  });
  it('fails on a new package with a known vulnerability, naming it and its advisories', () => {
    const io = fakeIo({ 'uv.lock': UV_LOCK }, { 'uv.lock': UV_LOCK.replace('version = "2.19.0"', 'version = "2.32.0"') });
    const result = pythonSupplyChainGate({ base: 'main', lockfile: 'uv.lock' }, io);
    expect(result).toMatchObject({ gate: 'supply-chain', pass: false, changed: ['requests@2.19.0'] });
    expect(result.findings).toEqual([expect.stringMatching(/^requests@2\.19\.0: known vulnerabilities PYSEC-2018-28, PYSEC-2023-74, /)]);
    expect(result.standing).toEqual([expect.stringMatching(/^idna@3\.7: known vulnerabilities PYSEC-2026-215/)]);
    expect(io.written['/tmp/audit-1/requirements.txt']).toBe('requests==2.19.0\nidna==3.7\n');
    expect(io.audits).toEqual([['-r', '/tmp/audit-1/requirements.txt', '--no-deps', '--disable-pip', '-f', 'json', '--progress-spinner', 'off']]);
    expect(io.removed).toEqual(['/tmp/audit-1']);
  });

  it('passes when the vulnerable packages were already at the base, and reports them', () => {
    const result = pythonSupplyChainGate({ base: 'main', lockfile: 'uv.lock' }, fakeIo({ 'uv.lock': UV_LOCK }, { 'uv.lock': UV_LOCK }));
    expect(result).toMatchObject({ pass: true, changed: [], findings: [] });
    expect(result.standing).toHaveLength(2);
  });

  it('treats every package as new without a base, or when the base has no lockfile', () => {
    expect(pythonSupplyChainGate({ lockfile: 'uv.lock' }, fakeIo({ 'uv.lock': UV_LOCK }))).toMatchObject({ pass: false, changed: ['requests@2.19.0', 'idna@3.7'] });
    expect(pythonSupplyChainGate({ base: 'main', lockfile: 'uv.lock' }, fakeIo({ 'uv.lock': UV_LOCK }))).toMatchObject({ pass: false });
  });

  it('reads the base from a saved lockfile', () => {
    const io = fakeIo({ 'uv.lock': UV_LOCK, 'state/uv.lock': UV_LOCK });
    expect(pythonSupplyChainGate({ 'base-file': 'state/uv.lock', lockfile: 'uv.lock' }, io)).toMatchObject({ pass: true });
  });

  it('passes a lockfile with no registry package without running pip-audit', () => {
    const io = fakeIo({ 'uv.lock': UV_LOCK.split('[[package]]\nname = "Requests"')[0]! });
    expect(pythonSupplyChainGate({ lockfile: 'uv.lock' }, io)).toMatchObject({ pass: true, changed: [], findings: [] });
    expect(io.audits).toEqual([]);
  });

  it('passes a clean audit', () => {
    const clean = JSON.stringify({ dependencies: [{ name: 'requests', version: '2.32.0', vulns: [] }], fixes: [] });
    expect(pythonSupplyChainGate({ lockfile: 'requirements.txt' }, fakeIo({ 'requirements.txt': 'requests==2.32.0\n' }, {}, { status: 0, stdout: clean }))).toMatchObject({ pass: true, findings: [] });
  });

  it('lets pip-audit resolve pyproject.toml or an unpinned requirements file itself, every vulnerability blocking', () => {
    const io = fakeIo({ 'app/pyproject.toml': '[project]\nname = "app"\n', 'requirements.txt': 'requests>=2\n' });
    expect(pythonSupplyChainGate({ base: 'main', lockfile: 'app/pyproject.toml' }, io)).toMatchObject({ pass: false, findings: [expect.stringMatching(/^requests@2\.19\.0/), expect.stringMatching(/^idna@3\.7/)] });
    expect(io.audits.at(-1)).toEqual(['app', '-f', 'json', '--progress-spinner', 'off']);
    expect(pythonSupplyChainGate({ lockfile: 'requirements.txt' }, io)).toMatchObject({ pass: false, unpinned: ['requests>=2'] });
    expect(io.audits.at(-1)).toEqual(['-r', 'requirements.txt', '-f', 'json', '--progress-spinner', 'off']);
  });

  it('cannot run without the lockfile, on an unknown ref, or when pip-audit fails', () => {
    expect(() => pythonSupplyChainGate({ lockfile: 'uv.lock' }, fakeIo({}))).toThrow('no lockfile at uv.lock');
    expect(() => pythonSupplyChainGate({ base: 'nope', lockfile: 'uv.lock' }, fakeIo({ 'uv.lock': UV_LOCK }))).toThrow('unknown git ref: nope');
    const broken = fakeIo({ 'uv.lock': UV_LOCK }, {}, { status: 2, stdout: '', stderr: 'Connection refused' });
    expect(() => pythonSupplyChainGate({ lockfile: 'uv.lock' }, broken)).toThrow('pip-audit exited 2: Connection refused');
    expect(broken.removed).toEqual(['/tmp/audit-1']);
  });
});

it('distinguishes real lockfile headers from lookalikes in comments', () => {
  const lock = [
    '# [[package]]', 'name = "Header"', 'version = "9"',
    '[[package]] # trailing text', 'name = "AnotherHeader"', 'version = "8"',
    '[[package]]   ', 'name = "Registry"', 'version = "1"',
    '# [fake]', '[package.dependencies] # trailing text',
    '# source = { virtual = "." }', '# type = "directory"',
    '[metadata]   ', 'type = "file"',
  ].join('\n');
  expect(pythonPackages('poetry.lock', lock)).toEqual({ pinned: [{ name: 'registry', version: '1' }], unpinned: [] });
});

it('keeps source information after package subtables and ignores lookalike table headers', () => {
  const lock = [
    '[[package]]', 'name = "Local"', 'version = "1"',
    '# [metadata]', '[metadata] # trailing text', '[metadata]#inline',
    '[package.source]', 'type = "directory"',
    '[[package]]', 'name = "PathLocal"', 'version = "1"',
    'source = {  directory = "./other" }',
    '[[package]]', 'name = "Registry"', 'version = "2"',
    '[metadata]   ', 'type = "file"',
  ].join('\n');
  expect(pythonPackages('poetry.lock', lock)).toEqual({ pinned: [{ name: 'registry', version: '2' }], unpinned: [] });
});

it('reads exact pins and preserves unpinned text with internal backslashes', () => {
  const text = [
    '# a whole comment',
    'pkg  [docs,typing]  ==  1.2.3',
    'next==2.2 # inline comment',
    'flask>=2  \\',
    'local @ file:///C:\\packages\\archive.whl',
    'invalid#pkg==3',
    'alpha>=1 # comment\u2028with a separator',
    'another==4.5\\',
  ].join('\n');
  expect(pythonPackages('requirements.txt', text)).toEqual({
    pinned: [{ name: 'pkg', version: '1.2.3' }, { name: 'next', version: '2.2' }, { name: 'another', version: '4.5' }],
    unpinned: ['flask>=2', 'local @ file:///C:\\packages\\archive.whl', 'invalid#pkg==3', 'alpha>=1 # comment\u2028with a separator'],
  });
  expect(pythonPackages('requirements.txt.bak', 'pkg==1')).toEqual({ pinned: [], unpinned: [] });
});

it('reports complete diagnostics from a failed pip-audit invocation', () => {
  const io = fakeIo({ 'requirements.txt': 'pkg==1' });
  io.pipAudit = () => ({ status: null, stdout: '', stderr: '  ', error: new Error('permission denied  ') });
  expect(() => pythonSupplyChainGate({ lockfile: 'requirements.txt' }, io))
    .toThrow(/^pip-audit exited null: permission denied$/);
  io.pipAudit = () => ({ status: 2, stdout: '', stderr: '  connection refused', error: new Error('network unavailable  ') });
  expect(() => pythonSupplyChainGate({ lockfile: 'requirements.txt' }, io))
    .toThrow(/^pip-audit exited 2: connection refused\nnetwork unavailable$/);
});

it('returns a clean exact-pin result for an empty lockfile', () => {
  expect(pythonSupplyChainGate({}, fakeIo({ 'uv.lock': 'version = 1' }))).toEqual({
    gate: 'supply-chain', pass: true, changed: [], findings: [], standing: [], notAudited: [],
  });
});
