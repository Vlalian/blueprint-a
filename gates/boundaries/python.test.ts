import { describe, expect, it } from 'vitest';
import { importLinterGate } from './python.ts';

// What import-linter 2.17 (`lint-imports --no-logo --no-cache`) printed on fixtures/python-sample
// with its forbidden contract kept, and broken by `from sample.grades import grade` in parity.py.
const KEPT = `---------
Contracts
---------

Analyzed 3 files, 0 dependencies.
---------------------------------

Parity stays independent of grades KEPT

Contracts: 1 kept, 0 broken.
`;

const BROKEN = `---------
Contracts
---------

Analyzed 3 files, 1 dependencies.
---------------------------------

Parity stays independent of grades BROKEN
Layers hold KEPT

Contracts: 1 kept, 1 broken.


----------------
Broken contracts
----------------

Parity stays independent of grades
----------------------------------

sample.parity is not allowed to import sample.grades:

-   sample.parity -> sample.grades (l.6)
-   sample.parity -> sample.grades.extra (l.7, l.9)

`;

const ran = (status: number | null, stdout: string, stderr = '') => ({ status, stdout, stderr });

describe('importLinterGate', () => {
  it('passes when every contract is kept', () => {
    expect(importLinterGate({ lintImports: () => ran(0, KEPT) })).toEqual({ gate: 'boundaries', pass: true, kept: 1, broken: 0, violations: [] });
  });

  it('fails on a broken contract and names it and each forbidden import with its line', () => {
    expect(importLinterGate({ lintImports: () => ran(1, BROKEN) })).toEqual({
      gate: 'boundaries',
      pass: false,
      kept: 1,
      broken: 1,
      violations: [
        { rule: 'Parity stays independent of grades', from: 'sample.parity', to: 'sample.grades', lines: '6' },
        { rule: 'Parity stays independent of grades', from: 'sample.parity', to: 'sample.grades.extra', lines: '7, 9' },
      ],
    });
  });

  it('reads CRLF output, ignoring imports before the broken section and keeping contracts distinct', () => {
    const stdout = [
      '-   stray -> import (l.1)',
      'Contracts: 10 kept, 12 broken.',
      'Broken contracts', '----------------',
      'Boundary A', '----------',
      '- source.one -> target.one (l.12)',
      'Boundary B', '----------',
      '- source.two -> target.two (l.23, l.45)',
      'this is prose, not an import',
    ].join('\r\n');
    expect(importLinterGate({ lintImports: () => ran(1, stdout) })).toEqual({
      gate: 'boundaries', pass: false, kept: 10, broken: 12, violations: [
        { rule: 'Boundary A', from: 'source.one', to: 'target.one', lines: '12' },
        { rule: 'Boundary B', from: 'source.two', to: 'target.two', lines: '23, 45' },
      ],
    });
  });

  it('removes the banner while preserving both stderr and process errors', () => {
    expect(() => importLinterGate({ lintImports: () => ({
      ...ran(null, '===\nImport Linter\n===\n Configuration incorrect  ', 'Check the config'),
      error: new Error('no process exit'),
    }) })).toThrow(/^import-linter could not run \(exit null\): Configuration incorrect  \nCheck the config\nno process exit$/);
  });

  it('cannot run without a contracts summary: no config, an import error, a crash', () => {
    expect(() => importLinterGate({ lintImports: () => ran(1, 'Could not read any configuration.\n') })).toThrow('import-linter could not run (exit 1): Could not read any configuration.');
    expect(() => importLinterGate({ lintImports: () => ran(1, '', 'ModuleNotFoundError: sample') })).toThrow('import-linter could not run (exit 1): ModuleNotFoundError: sample');
  });

  it('cannot run with no contract at all, rather than passing nothing', () => {
    expect(() => importLinterGate({ lintImports: () => ran(0, 'Contracts: 0 kept, 0 broken.\n') })).toThrow('import-linter checked no contract: add one to [tool.importlinter] in pyproject.toml or .importlinter');
  });
});

it.each(['note: Contracts: 1 kept, 0 broken.', 'Contracts: 1 kept, 0 broken. (cached)'])(
  'rejects a summary embedded in another line (%s)', (stdout) => {
    expect(() => importLinterGate({ lintImports: () => ran(1, stdout) }))
      .toThrow(new Error('import-linter could not run (exit 1): ' + stdout));
  },
);

it('accepts only whole section headings and import records', () => {
  const stdout = [
    'Contracts: 0 kept, 1 broken.',
    'Not Broken contracts', '----',
    'Wrong section', '----', '- stray -> first (l.1)',
    'Broken contracts', '---- note',
    'Still wrong', '----', '- stray -> second (l.2)',
    'Broken contracts', '----',
    'Actual rule', '----',
    'Prefix - third -> third (l.3)',
    '- fourth -> fourth (l.4) trailing text',
    'Not a heading', '---- note',
    '-   allowed.source -> target.module (l.17, l.21)',
  ].join('\n');
  expect(importLinterGate({ lintImports: () => ran(1, stdout) })).toEqual({
    gate: 'boundaries', pass: false, kept: 0, broken: 1,
    violations: [{ rule: 'Actual rule', from: 'allowed.source', to: 'target.module', lines: '17, 21' }],
  });
});

it('retains the indentation of later diagnostic lines and omits an empty stream', () => {
  expect(() => importLinterGate({ lintImports: () => ({
    ...ran(1, '===\nImport Linter\n===\nfirst', ''), error: new Error('last'),
  }) })).toThrow(/^import-linter could not run \(exit 1\): first\nlast$/);
});
