import { describe, expect, it } from 'vitest';
import { globToRegExp } from './glob.ts';

describe('globToRegExp', () => {
  it('matches ** across folders and * within one', () => {
    expect(globToRegExp('docs/adr/**').test('docs/adr/0001-x.md')).toBe(true);
    expect(globToRegExp('projects/*/directives.md').test('projects/a/b/directives.md')).toBe(false);
    expect(globToRegExp('projects/*/directives.md').test('projects/sample/directives.md')).toBe(true);
    expect(globToRegExp('CONTEXT.md').test('docs/CONTEXT.md')).toBe(false);
  });

  it('lets **/ stand for no folder at all', () => {
    expect(globToRegExp('**/x.md').test('x.md')).toBe(true);
    expect(globToRegExp('**/x.md').test('a/b/x.md')).toBe(true);
    expect(globToRegExp('a/**/b').test('a/b')).toBe(true);
    expect(globToRegExp('a/**/b').test('a/x/y/b')).toBe(true);
    expect(globToRegExp('a/**/b').test('a/xb')).toBe(false);
  });

  it('matches ? as one character of a name', () => {
    expect(globToRegExp('a?.md').test('ab.md')).toBe(true);
    expect(globToRegExp('a?.md').test('a/.md')).toBe(false);
    expect(globToRegExp('a?.md').test('abc.md')).toBe(false);
  });

  it('ignores case, as Windows does', () => {
    expect(globToRegExp('CONTEXT.md').test('context.MD')).toBe(true);
  });

  it.each(['a.b', 'a+b', 'a^b', 'a$b', 'x{1}', 'a}b', 'a(b', 'a)b', 'a|b', 'a[b', 'a]b', String.raw`a\b`])('reads %s literally', (glob) => {
    expect(globToRegExp(glob).test(glob)).toBe(true);
  });

  it('does not let a literal character act as regex syntax', () => {
    expect(globToRegExp('a.b').test('aXb')).toBe(false);
    expect(globToRegExp('a+b').test('aab')).toBe(false);
    expect(globToRegExp('a|b').test('b')).toBe(false);
  });
});
