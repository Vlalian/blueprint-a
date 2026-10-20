import { describe, expect, it } from 'vitest';
import { isTestFile } from './test-files.ts';

describe('isTestFile', () => {
  it.each(['a.test.ts', 'src/a.test.tsx', 'a.test.js', 'a.test.mjs', 'a.test.cts', 'a.spec.ts', 'src/a.spec.jsx', 'a.integration.test.ts'])('reads %s as a test file', (p) => {
    expect(isTestFile(p)).toBe(true);
  });

  it.each(['a.ts', 'test.ts', 'a.test.ts.bak', 'a.testx.ts', 'a.test.json', 'node_modules/x/a.test.ts', 'a/node_modules/b.spec.ts', 'atest.ts'])('does not read %s as a test file', (p) => {
    expect(isTestFile(p)).toBe(false);
  });
});
