// Prove the prose lint bites: it is a library with no CLI, so a finding counts as exit 1. Plain
// prose passes, a banned word fails, and the plain prose passes again.
import { describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { lintProse } from './lint.ts';

describe('the prose lint bites', () => {
  it('passes plain prose, fails it once a banned word is in, passes again once it is out', () => {
    const PLAIN = 'The gate reads the diff and fails on a copied block.\n';
    let text = PLAIN;
    const run = () => (lintProse(text).length === 0 ? 0 : 1);
    expect(proveItBites({ run, inject: () => (text = `${PLAIN}We delve into the diff.\n`), revert: () => (text = PLAIN) })).toEqual(BITES);
  });
});
