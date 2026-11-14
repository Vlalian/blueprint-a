// The permissive licence allowlist the supply-chain gate checks each new package against. It came
// from the tool licence gate (gates/licence, deleted in ticket 95), which found the npm name
// crap4ts pointing at a GPL package by a different author than the MIT one people read about.

export const ALLOWED_LICENCES = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD'];

/** An SPDX id on the allowlist, or an `OR` expression with one on either side. */
export const licenceOk = (license: string) => license.split(/\bOR\b/i).some((part) => ALLOWED_LICENCES.includes(part.replace(/[()\s]/g, '')));
