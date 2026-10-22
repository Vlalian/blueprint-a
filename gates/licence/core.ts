// Tool licence check (from the /onkel research, which found the npm name crap4ts pointing at a
// GPL package by a different author than the MIT one people read about): before a gate tool is
// installed, its licence must be permissive and its repository must be the one we meant.

export interface PackageFacts {
  name: string;
  license?: string;
  repository?: string;
}

export const ALLOWED_LICENCES = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD'];

/** An SPDX id on the allowlist, or an `OR` expression with one on either side. */
export const licenceOk = (license: string) => license.split(/\bOR\b/i).some((part) => ALLOWED_LICENCES.includes(part.replace(/[()\s]/g, '')));

function findingFor(expectRepo: string, f: PackageFacts): string | undefined {
  if (!f.license) return `${f.name}: no licence declared`;
  if (!licenceOk(f.license)) return `${f.name}: licence "${f.license}" is not on the allowlist (${ALLOWED_LICENCES.join(', ')})`;
  if (!(f.repository ?? '').includes(expectRepo)) return `${f.name}: repository ${f.repository} is not the expected ${expectRepo}`;
  return undefined;
}

export function licenceFindings(packages: Array<{ expectRepo: string; facts: PackageFacts }>): string[] {
  return packages.map((p) => findingFor(p.expectRepo, p.facts)).filter((m): m is string => m !== undefined);
}
