// The tests a pytest file holds (ticket 99), for the test-deletion guard: module-level `def test_*`
// (or `async def`), and the same in a `class Test*` body, named `Class::test_*` as pytest names them.
// A test under `@pytest.mark.skip` or `skipif`, or in a class under one, is switched off, which
// counts as deleted like a JS `it.skip`. Read line by line: a def nested deeper than the module or
// a class body (a helper inside a test) is no test, and neither is text in a docstring. Pure.

import type { TestCase } from './core.ts';

const DEF = /^(?:async\s+)?def\s+(test\w*)\s*\(/;
const CLASS = /^class\s+(Test\w*)\b/;
const SKIP = /^@(?:pytest\.mark\.|unittest\.)?skip(?:if)?\b/;

interface State {
  cases: TestCase[];
  /** The test class the lines are in, whether it is skipped, and its body's indent once seen. */
  cls?: { name: string; off: boolean; indent?: number };
  /** A skip decorator stands above the next def or class. */
  skip: boolean;
}

const indentOf = (line: string) => line.length - line.trimStart().length;
const ignorable = (text: string) => text === '' || text.startsWith('#');

function topLevel(s: State, line: string): State {
  const cls = CLASS.exec(line);
  if (cls !== null) return { cases: s.cases, cls: { name: cls[1]!, off: s.skip }, skip: false };
  const def = DEF.exec(line);
  return { cases: def === null ? s.cases : [...s.cases, { title: def[1]!, active: !s.skip }], skip: false };
}

function inClass(s: State, cls: NonNullable<State['cls']>, line: string): State {
  const indent = cls.indent ?? indentOf(line);
  const def = indentOf(line) === indent ? DEF.exec(line.trimStart()) : null;
  const cases = def === null ? s.cases : [...s.cases, { title: `${cls.name}::${def[1]}`, active: !s.skip && !cls.off }];
  return { cases, cls: { ...cls, indent }, skip: false };
}

const decorated = (s: State, text: string): State => ({ ...s, skip: s.skip || SKIP.test(text) });

function step(s: State, line: string): State {
  const text = line.trim();
  if (ignorable(text)) return s;
  if (text.startsWith('@')) return decorated(s, text);
  if (indentOf(line) === 0) return topLevel(s, line);
  return s.cls === undefined ? s : inClass(s, s.cls, line);
}

/** The test functions of a pytest file, in order. */
export const pytestCases = (source: string): TestCase[] => source.split(/\r?\n/).reduce(step, { cases: [], skip: false }).cases;
