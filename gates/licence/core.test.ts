import { describe, expect, it } from 'vitest';
import { ALLOWED_LICENCES, licenceFindings, licenceOk, type PackageFacts } from './core.ts';

const facts = (over: Partial<PackageFacts> = {}): PackageFacts => ({
  name: 'jscpd',
  license: 'MIT',
  repository: 'git+https://github.com/kucherenko/jscpd.git',
  ...over,
});

describe('licenceFindings', () => {
  it('passes a permissive licence from the expected repository', () => {
    expect(licenceFindings([{ expectRepo: 'github.com/kucherenko/jscpd', facts: facts() }])).toEqual([]);
  });

  it('refuses a copyleft or missing licence', () => {
    expect(licenceFindings([{ expectRepo: 'github.com/kucherenko/jscpd', facts: facts({ license: 'GPL-3.0' }) }])).toEqual([
      'jscpd: licence "GPL-3.0" is not on the allowlist (MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD)',
    ]);
    expect(licenceFindings([{ expectRepo: 'x', facts: facts({ license: undefined, repository: 'x' }) }])).toEqual(['jscpd: no licence declared']);
  });

  it('refuses a package whose repository is not the one expected (the crap4ts name collision)', () => {
    expect(licenceFindings([{ expectRepo: 'github.com/sebassdc/crap4ts', facts: facts({ name: 'crap4ts', repository: 'github.com/someone-else/crap4ts' }) }])).toEqual([
      'crap4ts: repository github.com/someone-else/crap4ts is not the expected github.com/sebassdc/crap4ts',
    ]);
  });

  it('accepts an SPDX "OR" expression when one side is allowed', () => {
    expect(licenceFindings([{ expectRepo: 'r', facts: facts({ license: '(MIT OR GPL-3.0)', repository: 'r' }) }])).toEqual([]);
  });

  it('lists the allowed licences', () => {
    expect(ALLOWED_LICENCES).toEqual(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD']);
  });
});

describe('licenceOk', () => {
  it.each(['MIT', '(MIT OR GPL-3.0)', '(GPL-3.0 OR MIT)', 'GPL-3.0 or MIT', ' MIT ', 'GPL-3.0  OR  ISC', '(BSD-3-Clause)'])('allows %j', (license) => {
    expect(licenceOk(license)).toBe(true);
  });

  it.each(['GPL-3.0', 'MIT AND GPL-3.0', 'GPL-3.0ORMIT', 'XMIT', '(GPL-3.0 OR AGPL-3.0)', ''])('refuses %j', (license) => {
    expect(licenceOk(license)).toBe(false);
  });
});
