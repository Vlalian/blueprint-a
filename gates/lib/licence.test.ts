import { describe, expect, it } from 'vitest';
import { ALLOWED_LICENCES, licenceOk } from './licence.ts';

describe('licenceOk', () => {
  it('lists the allowed licences', () => {
    expect(ALLOWED_LICENCES).toEqual(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD']);
  });

  it.each(['MIT', '(MIT OR GPL-3.0)', '(GPL-3.0 OR MIT)', 'GPL-3.0 or MIT', ' MIT ', 'GPL-3.0  OR  ISC', '(BSD-3-Clause)'])('allows %j', (license) => {
    expect(licenceOk(license)).toBe(true);
  });

  it.each(['GPL-3.0', 'MIT AND GPL-3.0', 'GPL-3.0ORMIT', 'XMIT', '(GPL-3.0 OR AGPL-3.0)', ''])('refuses %j', (license) => {
    expect(licenceOk(license)).toBe(false);
  });
});
