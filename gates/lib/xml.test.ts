import { describe, expect, it } from 'vitest';
import { decode, descendants, parseXml, under } from './xml.ts';

describe('parseXml', () => {
  it('gives a nameless root holding the elements, their decoded attributes, children and text', () => {
    expect(parseXml('<a k="&lt;1" n="2">x<b/>y<c>z</c></a>')).toEqual({
      name: '',
      attrs: {},
      children: [
        {
          name: 'a',
          attrs: { k: '<1', n: '2' },
          children: [
            { name: 'b', attrs: {}, children: [], text: '' },
            { name: 'c', attrs: {}, children: [], text: 'z' },
          ],
          text: 'xy',
        },
      ],
      text: '',
    });
  });

  it('skips the prolog', () => {
    expect(parseXml('<?xml version="1.0" encoding="utf-8"?><a/>').children.map((e) => e.name)).toEqual(['a']);
  });
});

describe('decode', () => {
  it('decodes named, decimal and hex entities, as ElementTree writes a newline in an attribute', () => {
    expect(decode('a &gt; b&#10;c&#x41;&amp;lt;')).toBe('a > b\ncA&lt;');
  });
});

describe('under and descendants', () => {
  const root = parseXml('<s><c n="1"><k/></c><g><c n="2"/></g></s>');

  it('follows child names in order', () => {
    expect(under([root], ['s', 'c']).map((e) => e.attrs.n)).toEqual(['1']);
  });

  it('finds an element at any depth', () => {
    expect(descendants(root, 'c').map((e) => e.attrs.n)).toEqual(['1', '2']);
  });
});
