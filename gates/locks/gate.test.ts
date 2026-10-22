import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_LOCKS, lockList, locksCommand, type LocksIo } from './gate.ts';

const AGREED = 'Agreed: 2026-10-07 (Ada: "add the locks")';
const CONSENT = join('config', 'consent.json');
const FILE = join('gates', 'x.ts');
const MANIFEST = join('config', 'locks.lock');

function setup(branch = 'ticket/67-locked-files', ticket = AGREED) {
  const files = new Map<string, string>([
    [join('config', 'locks.json'), JSON.stringify(['gates/**', 'config/**'])],
    [MANIFEST, JSON.stringify({ 'gates/x.ts': 'old' })],
    [CONSENT, '{"owner":"Ada","tickets":"docs/tickets"}'],
    [FILE, 'abc'],
    [join('docs', 'tickets', '67-locked-files.md'), ticket],
  ]);
  const io: LocksIo = {
    list: () => [...files.keys()],
    read: (p) => files.get(p),
    write: (p, t) => void files.set(p, t),
    branch: () => branch,
  };
  return { files, io };
}

it('passes a changed locked file on an agreed ticket and relocks its exact bytes', () => {
  const s = setup();
  expect(locksCommand(false, s.io)).toMatchObject({ gate: 'locks', pass: true, changed: ['config/consent.json', 'config/locks.json', 'gates/x.ts'] });
  expect(locksCommand(true, s.io).pass).toBe(true);
  expect(JSON.parse(s.files.get(MANIFEST)!)['gates/x.ts']).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(locksCommand(false, { ...s.io, branch: () => 'night/2026-10-04' })).toMatchObject({ pass: true, changed: [] });
});

it.each(['ticket/67-locked-files', 'main', 'night/2026-10-04', 'feature/67', ''])('refuses unagreed changes on %s naming the locked files', (branch) => {
  const s = setup(branch, 'Agreed: 2026-10-07 (someone said yes)');
  expect(locksCommand(false, s.io)).toEqual({ gate: 'locks', pass: false, changed: ['config/consent.json', 'config/locks.json', 'gates/x.ts'] });
});

it('accepts only a ticket document on a ticket branch, never an unrelated file or a quote below its header', () => {
  const s = setup('main');
  s.files.set(join('docs', 'tickets', 'undefined-fake.md'), AGREED);
  expect(locksCommand(false, s.io).pass).toBe(false);
  const backup = setup('ticket/67-locked-files', 'proposed');
  backup.files.delete(join('docs', 'tickets', '67-locked-files.md'));
  backup.files.set(join('docs', 'tickets', '67-locked-files.md.backup'), AGREED);
  expect(locksCommand(false, backup.io).pass).toBe(false);
  const body = setup('ticket/67-locked-files', `Status: proposed\n## Result\n${AGREED}`);
  expect(locksCommand(false, body.io).pass).toBe(false);
});

it('allows docs and runtime changes outside any ticket, but detects new and deleted locked files', () => {
  const s = setup('main');
  locksCommand(true, s.io);
  s.files.set(join('docs', 'proposal.md'), 'change');
  s.files.set(join('state', 'run.json'), '{}');
  expect(locksCommand(false, s.io)).toEqual({ gate: 'locks', pass: true, changed: [] });
  s.files.delete(FILE);
  s.files.set(join('gates', 'new.ts'), 'new');
  expect(locksCommand(false, s.io)).toEqual({ gate: 'locks', pass: false, changed: ['gates/new.ts', 'gates/x.ts'] });
});

it('detects a line-ending edit as a locked byte change (the repo checks out LF via .gitattributes)', () => {
  const s = setup('night/2026-10-04');
  s.files.set(FILE, 'abc\n');
  locksCommand(true, s.io);
  expect(JSON.parse(s.files.get(MANIFEST)!)['gates/x.ts']).toBe('edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb');
  s.files.set(FILE, 'abc\r\n');
  expect(locksCommand(false, s.io)).toEqual({ gate: 'locks', pass: false, changed: ['gates/x.ts'] });
});

it('relocks only matching readable paths in sorted order with exact JSON bytes', () => {
  const files = new Map([
    [join('config', 'locks.json'), '["gates/**","config/locks.lock"]'],
    [MANIFEST, 'old manifest'],
    [join('gates', 'z.ts'), 'abc'],
    [join('gates', 'a.ts'), ''],
    [join('docs', 'ignored.md'), 'ignored'],
  ]);
  const io: LocksIo = {
    list: () => [...files.keys(), join('gates', 'deleted.ts')],
    read: (p) => files.get(p),
    write: (p, text) => void files.set(p, text),
    branch: () => 'main',
  };
  expect(locksCommand(true, io)).toEqual({ gate: 'locks', pass: true, changed: [] });
  expect(files.get(MANIFEST)).toBe(
    '{\n  "gates/a.ts": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",\n  "gates/z.ts": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"\n}\n',
  );
});

it('locks the default list without a config/locks.json: gates, config and build files, never docs or app code', () => {
  const files = new Map<string, string>([
    [MANIFEST, '{}'], [CONSENT, '{"owner":"Ada","tickets":"docs/tickets"}'],
    ['package.json', '{}'], [join('.github', 'workflows', 'ci.yml'), 'on: push'], [join('src', 'App', 'NuGet.Config'), 'x'],
    ['Directory.Build.props', '<Project/>'], [join('tests', 'unit.runsettings'), 'x'], [join('src', 'a.ts'), 'a'], ['README.md', 'r'],
  ]);
  const io: LocksIo = { list: () => [...files.keys()], read: (p) => files.get(p), write: () => undefined, branch: () => 'main' };
  expect(lockList(io)).toBe(DEFAULT_LOCKS);
  expect(DEFAULT_LOCKS).toEqual([
    'gates/**', 'adapters/**', 'config/**', 'AGENTS.md',
    '.github/workflows/**', 'azure-pipelines.yml', '.azure-pipelines/**', '.husky/**', '.githooks/**',
    'package.json', 'package-lock.json', 'tsconfig*.json', 'vitest*.config.*', 'jest.config.*', 'stryker.config.*', 'eslint.config.*',
    'global.json', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'nuget.config', '.editorconfig', 'stryker-config.json', '**/*.runsettings',
  ]);
  expect(locksCommand(false, io)).toEqual({
    gate: 'locks', pass: false,
    changed: ['.github/workflows/ci.yml', 'Directory.Build.props', 'config/consent.json', 'package.json', 'tests/unit.runsettings'],
  });
});

it('refuses a locked change on an agreed branch without a consent config, and cannot run with an empty one', () => {
  const s = setup();
  s.files.delete(CONSENT);
  expect(locksCommand(false, s.io)).toEqual({ gate: 'locks', pass: false, changed: ['config/locks.json', 'gates/x.ts'] });
  s.files.set(CONSENT, '{"owner":"Ada"}');
  expect(() => locksCommand(false, s.io)).toThrow('consent config needs a non-empty "tickets"');
});
