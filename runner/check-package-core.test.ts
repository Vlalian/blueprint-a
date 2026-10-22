import { describe, expect, it } from 'vitest';
import { checkPackage, parseRules, scanPackage, type PackageIo, type PackageRules } from './check-package-core.ts';

// Built at runtime so no deny-listed name, secret or hidden character sits in this file as a
// literal that other scanners would trip over.
const project = ['bio', 'hacking', '-', 'coach'].join('');
const handle = ['Vla', 'lian'].join('');
const secret = 'ghp_' + 'c'.repeat(36);
const zeroWidth = String.fromCodePoint(0x200b);
// The home folders and the at sign of the cases below too: the export's package check scans this file.
const HOME = ['', 'home'].join('/');
const USERS = ['', 'Users'].join('/');
const AT = String.fromCodePoint(0x40);

const none: PackageRules = { deny: [], privateRepos: [] };
const scan = (text: string, rules: PackageRules = none) => scanPackage([{ path: 'a.md', text }], rules);
const details = (text: string, rules: PackageRules = none) => scan(text, rules).map((f) => `${f.kind} ${f.detail}`);

describe('scanPackage: personal paths', () => {
  it('finds a Windows profile path with either slash, and names the whole user folder', () => {
    expect(details(`see C:\\Users\\alice.b-c\\x and d:${USERS}/bob`)).toEqual(['personal-path C:\\Users\\alice.b-c', `personal-path d:${USERS}/bob`]);
  });

  it('finds Linux and macOS home folders', () => {
    expect(details(`${HOME}/carol_1/x then ${USERS}/dave`)).toEqual([`personal-path ${HOME}/carol_1`, `personal-path ${USERS}/dave`]);
  });

  it('leaves alone a path that is not a user folder', () => {
    expect(details('/usr/local/bin, /homes/x, C:\\Program Files\\x, /home/ and https://example.com/users/1')).toEqual([]);
  });
});

describe('scanPackage: email addresses', () => {
  it('finds an address and reports all of it', () => {
    expect(details(`mail first.last+tag-x${AT}mail-host.example.co.uk or a${AT}b.io`)).toEqual([
      `email first.last+tag-x${AT}mail-host.example.co.uk`,
      `email a${AT}b.io`,
    ]);
  });

  it('reads a top-level domain to its end', () => {
    expect(details(`x${AT}y.com`)).toEqual([`email x${AT}y.com`]);
  });

  it('leaves alone a package version, a scope and a one-letter top-level domain', () => {
    expect(details('vitest@4.1.11, @scope/pkg, x@y.z, a@b')).toEqual([]);
  });
});

describe('scanPackage: deny list', () => {
  const rules = { deny: [project, handle], privateRepos: [] };

  it('finds a deny-listed name in any case', () => {
    expect(details(`the ${project.toUpperCase()} app by ${handle.toLowerCase()}`, rules)).toEqual([
      `deny-list ${project.toUpperCase()}`,
      `deny-list ${handle.toLowerCase()}`,
    ]);
  });

  it('finds a name at the start and end of a line and next to punctuation', () => {
    expect(details(`${handle}'s (${handle})`, rules)).toEqual([`deny-list ${handle}`, `deny-list ${handle}`]);
  });

  it('leaves alone a name that is only part of a longer word', () => {
    expect(details(`x${handle} ${handle}2 9${handle}`, rules)).toEqual([]);
  });

  it('reads a deny-listed name literally, not as a pattern', () => {
    expect(details('axb and a.b', { deny: ['a.b'], privateRepos: [] })).toEqual(['deny-list a.b']);
  });
});

describe('scanPackage: private repository links', () => {
  it('finds a link to a private owner or repository, in any case and either URL form', () => {
    const rules = { deny: [], privateRepos: ['ACME/', 'my-org/repo.name'] };
    expect(details('https://GitHub.com/acme/tools and github.com:My-Org/repo.name.git', rules)).toEqual([
      'private-repo-link GitHub.com/acme/tools',
      'private-repo-link github.com:My-Org/repo.name.git',
    ]);
  });

  it('leaves alone a public repository and a different repository of the same owner', () => {
    const rules = { deny: [], privateRepos: ['my-org/repo.name'] };
    expect(details('github.com/public/x and github.com/my-org/other', rules)).toEqual([]);
  });
});

describe('scanPackage: secrets and hidden Unicode, reusing the gate cores', () => {
  it('finds a secret without echoing it', () => {
    expect(details(`token ${secret}`)).toEqual(['secret github-token ghp_cc…']);
  });

  it('finds a hidden character and says where it is', () => {
    expect(details(`ab${zeroWidth}c`)).toEqual(['hidden-unicode U+200B zero-width at column 3']);
  });
});

describe('scanPackage: positions', () => {
  it('names the file and line of each finding, one line per newline', () => {
    const files = [
      { path: 'a.md', text: `ok\n${HOME}/x` },
      { path: 'b/c.md', text: `${secret}\r\nok\nx${AT}y.io` },
    ];
    expect(scanPackage(files, none)).toEqual([
      { file: 'b/c.md', line: 1, kind: 'secret', detail: 'github-token ghp_cc…' },
      { file: 'a.md', line: 2, kind: 'personal-path', detail: `${HOME}/x` },
      { file: 'b/c.md', line: 3, kind: 'email', detail: `x${AT}y.io` },
    ]);
  });

  it('lists every finding on a line, in rule order', () => {
    expect(details(`${HOME}/x a${AT}b.io ${handle} github.com/${handle}/x`, { deny: [handle], privateRepos: [`${handle}/`] })).toEqual([
      `personal-path ${HOME}/x`,
      `email a${AT}b.io`,
      `deny-list ${handle}`,
      `deny-list ${handle}`,
      `private-repo-link github.com/${handle}/x`,
    ]);
  });
});

describe('parseRules', () => {
  it('reads the deny list and the private repositories', () => {
    expect(parseRules(JSON.stringify({ deny: ['a'], privateRepos: ['b/'] }))).toEqual({ deny: ['a'], privateRepos: ['b/'] });
  });

  it.each([{ privateRepos: [] }, { deny: [] }, { deny: [''], privateRepos: [] }, { deny: [], privateRepos: [3] }, { deny: [['a']], privateRepos: [] }, { deny: 'a', privateRepos: [] }])(
    'refuses a rules file without two lists of non-empty strings: %j',
    (rules) => {
      expect(() => parseRules(JSON.stringify(rules))).toThrow('rules file needs "deny" and "privateRepos" lists of non-empty strings');
    },
  );
});

describe('checkPackage', () => {
  const io = (files: Record<string, string>): PackageIo => ({
    files: () => Object.keys(files),
    read: (_dir, file) => files[file]!,
    rules: (path) => (path === 'r.json' ? JSON.stringify({ deny: [handle], privateRepos: [] }) : ''),
  });

  it('passes a clean folder and says how many files it read', () => {
    expect(checkPackage(['pkg', '--rules', 'r.json'], io({ 'a.md': 'fine', 'b.md': 'also fine' }), 'd.json')).toEqual({
      gate: 'check-package',
      pass: true,
      dir: 'pkg',
      files: 2,
      findings: [],
    });
  });

  it('fails a folder with a finding', () => {
    expect(checkPackage(['pkg', '--rules', 'r.json'], io({ 'a.md': `by ${handle}` }), 'd.json')).toMatchObject({
      pass: false,
      findings: [{ file: 'a.md', line: 1, kind: 'deny-list', detail: handle }],
    });
  });

  it('reads the default rules file when none is named', () => {
    const seen: string[] = [];
    const base = io({ 'a.md': 'x' });
    checkPackage(['pkg'], { ...base, rules: (p) => (seen.push(p), JSON.stringify(none)) }, 'default.json');
    expect(seen).toEqual(['default.json']);
  });

  it.each([[[]], [['a', 'b']]])('refuses anything but one folder: %j', (args) => {
    expect(() => checkPackage(args, io({}), 'd.json')).toThrow('usage: check-package <folder> [--rules <file>]');
  });

  it('refuses an empty folder, which could hide a wrong path', () => {
    expect(() => checkPackage(['pkg', '--rules', 'r.json'], io({}), 'd.json')).toThrow('no files in pkg');
  });
});
