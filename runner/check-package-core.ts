// The package check with its I/O passed in, so it is tested in-process (and mutation-tested);
// check-package.ts only wires in the file system. Before a folder leaves this repo (the
// Blueprint A package), it must hold no secret, hidden character, personal path, email address,
// deny-listed private name or link to a private repository.

import { parseArgs } from 'node:util';
import type { GateResult } from '../gates/lib/contract.ts';
import type { AddedLine } from '../gates/lib/diff.ts';
import { scanHiddenUnicode } from '../gates/hidden-unicode/core.ts';
import { scanSecrets } from '../gates/secret-scan/core.ts';

export interface PackageRules {
  /** Private names (projects, people, handles), matched as whole words in any case. */
  deny: string[];
  /** `owner/` for every repository of an owner, or `owner/repo`; matched in any case. */
  privateRepos: string[];
}

export interface PackageFile {
  path: string;
  text: string;
}

export interface PackageFinding {
  file: string;
  line: number;
  kind: string;
  detail: string;
}

export interface PackageIo {
  /** Every file under the folder, as paths relative to it. */
  files(dir: string): string[];
  read(dir: string, file: string): string;
  /** The text of the rules file at this path. */
  rules(path: string): string;
}

const USAGE = 'usage: check-package <folder> [--rules <file>]';
const RULES_SHAPE = 'rules file needs "deny" and "privateRepos" lists of non-empty strings';

const PERSONAL_PATH = /(?:[A-Za-z]:[\\/]Users[\\/]|\/(?:home|Users)\/)[\w.-]+/g;
// The top-level domain must be letters, so a package version such as `x@4.1.11` is not an address.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g;
const REPO_LINK = /github\.com[/:]([\w.-]+\/[\w.-]+)/gi;

const found = (re: RegExp, text: string) => [...text.matchAll(re)];

// Every character that is not a letter, digit or underscore is escaped, so a name is read literally.
const denyPattern = (name: string) => new RegExp(`(?<![A-Za-z0-9])${name.replace(/\W/g, '\\$&')}(?![A-Za-z0-9])`, 'gi');

const isPrivate = (rules: PackageRules, slug: string) => rules.privateRepos.some((r) => slug.toLowerCase().startsWith(r.toLowerCase()));

function textFindings(text: string, rules: PackageRules): Array<[kind: string, detail: string]> {
  return [
    ...found(PERSONAL_PATH, text).map((m) => ['personal-path', m[0]] as [string, string]),
    ...found(EMAIL, text).map((m) => ['email', m[0]] as [string, string]),
    ...rules.deny.flatMap((name) => found(denyPattern(name), text).map((m) => ['deny-list', m[0]] as [string, string])),
    ...found(REPO_LINK, text)
      .filter((m) => isPrivate(rules, m[1]))
      .map((m) => ['private-repo-link', m[0]] as [string, string]),
  ];
}

export function scanPackage(files: PackageFile[], rules: PackageRules): PackageFinding[] {
  const lines: AddedLine[] = files.flatMap(({ path, text }) => text.split('\n').map((t, i) => ({ file: path, line: i + 1, text: t })));
  return [
    ...scanSecrets(lines).map(({ file, line, kind, excerpt }) => ({ file, line, kind: 'secret', detail: `${kind} ${excerpt}` })),
    ...scanHiddenUnicode(lines).map(({ file, line, column, codePoint, name }) => ({
      file,
      line,
      kind: 'hidden-unicode',
      detail: `${codePoint} ${name} at column ${column}`,
    })),
    ...lines.flatMap(({ file, line, text }) => textFindings(text, rules).map(([kind, detail]) => ({ file, line, kind, detail }))),
  ];
}

const isNames = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

export function parseRules(json: string): PackageRules {
  const r = JSON.parse(json) as Partial<PackageRules>;
  if (!isNames(r.deny) || !isNames(r.privateRepos)) throw new Error(RULES_SHAPE);
  return { deny: r.deny!, privateRepos: r.privateRepos! };
}

export function checkPackage(args: string[], io: PackageIo, defaultRules: string): GateResult & { findings: PackageFinding[] } {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { rules: { type: 'string' } } });
  if (positionals.length !== 1) throw new Error(USAGE);
  const [dir] = positionals;
  const files = io.files(dir!);
  if (files.length === 0) throw new Error(`no files in ${dir}`);
  const rules = parseRules(io.rules(values.rules ?? defaultRules));
  const findings = scanPackage(
    files.map((path) => ({ path, text: io.read(dir!, path) })),
    rules,
  );
  return { gate: 'check-package', pass: findings.length === 0, dir, files: files.length, findings };
}
