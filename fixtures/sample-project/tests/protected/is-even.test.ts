import { expect, it } from 'vitest';
import { isEven } from '../../src/is-even.ts';

it('3 is odd', () => {
  expect(isEven(3)).toBe(false);
});
