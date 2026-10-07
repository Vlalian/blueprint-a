// Property tests: run with `npm test`, never counted by onkel (gates/onkel/property-tests.ts).

import fc from 'fast-check';
import { expect, it } from 'vitest';
import { gradedSources } from './gate.ts';

const segment = fc.stringMatching(/^[a-z_-]{1,8}$/);
const path = fc
  .tuple(fc.array(segment, { maxLength: 3 }), segment, fc.constantFrom('.ts', '.test.ts', '.property.test.ts', '.d.ts', '.tsx', '.md', ''))
  .map(([dirs, name, ext]) => [...dirs, `${name}${ext}`].join('/'));

it('keeps an ordered subset of what it is given', () => {
  fc.assert(
    fc.property(fc.array(path), (paths) => {
      const kept = gradedSources(paths);
      expect(paths.filter((p) => kept.includes(p))).toEqual(kept);
    }),
  );
});

it('never keeps a test or a declaration, and keeping is idempotent', () => {
  fc.assert(
    fc.property(fc.array(path), (paths) => {
      const kept = gradedSources(paths);
      expect(kept.filter((p) => p.endsWith('.test.ts') || p.endsWith('.d.ts'))).toEqual([]);
      expect(gradedSources(kept)).toEqual(kept);
    }),
  );
});
