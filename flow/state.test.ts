import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from './config.ts';
import { builderIn, flowPath, hasResult, jsonOf, jsonText, nameOfTicket, roundIn, ticketFile, ticketNameOf, ticketOf, upTo, worktreePath } from './state.ts';

describe('the flow state', () => {
  it('lives in the configured folders under the root', () => {
    expect(flowPath('/r', { stateDir: 'var/flow' }, 'a.json')).toBe(join('/r', 'var', 'flow', 'a.json'));
    expect(worktreePath('/r', { worktreeDir: '.wt/flow' }, 'gate')).toBe(join('/r', '.wt', 'flow', 'gate'));
  });

  it('reads a state file, empty when there is none, naming one it cannot read', () => {
    expect(jsonOf('{"a":1}', {}, 'x.json')).toEqual({ a: 1 });
    expect(jsonOf(undefined, [], 'x.json')).toEqual([]);
    expect(() => jsonOf('{', [], 'x.json')).toThrow(/^x\.json could not be read: /);
    expect(jsonText({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe("the package's own files", () => {
  it('are found in the nearest folder at or above that has them, the top one when none has', () => {
    const top = resolve('/');
    const deep = join(top, 'a', 'b', 'c');
    const has = (where: string) => (path: string) => path === join(where, 'x', 'y.ts');
    expect(upTo(deep, join('x', 'y.ts'), has(deep))).toBe(join(deep, 'x', 'y.ts'));
    expect(upTo(deep, join('x', 'y.ts'), has(join(top, 'a')))).toBe(join(top, 'a', 'x', 'y.ts'));
    expect(upTo(deep, join('x', 'y.ts'), () => false)).toBe(join(top, 'x', 'y.ts'));
  });
});

describe('a ticket', () => {
  it('is named by its branch under the configured prefix', () => {
    expect(ticketNameOf('ticket/12-login', DEFAULTS)).toBe('12-login');
    expect(ticketNameOf('feature/12-login', { branchPrefix: 'feature/' })).toBe('12-login');
    expect(ticketNameOf('feature/12-login', DEFAULTS)).toBeUndefined();
    expect(ticketNameOf('ticket/login', DEFAULTS)).toBeUndefined();
    expect(ticketNameOf('ticket/12-login/x', DEFAULTS)).toBeUndefined();
    expect(ticketNameOf('ticket/12-', DEFAULTS)).toBeUndefined();
    expect(ticketNameOf('ticket/12-login.v2', DEFAULTS)).toBe('12-login.v2');
    expect(ticketNameOf('x/ticket/12-login', DEFAULTS)).toBeUndefined();
    expect(ticketNameOf('tickex/12-login', DEFAULTS)).toBeUndefined();
    expect(ticketNameOf('ticket/x12-login', DEFAULTS)).toBeUndefined();
    expect(ticketNameOf('ticket/15c-x', DEFAULTS)).toBe('15c-x');
  });

  it('has its number and its file', () => {
    expect(ticketOf('12-login')).toBe('12');
    expect(ticketOf('15c-x')).toBe('15c');
    expect(ticketOf('login')).toBeUndefined();
    expect(ticketOf('12')).toBeUndefined();
    expect(ticketOf('x12-login')).toBeUndefined();
    expect(ticketFile('12-login', DEFAULTS)).toBe('docs/tickets/12-login.md');
  });

  it('is found among the ticket files by its number', () => {
    const files = ['1-a.md', '12-login.md', '15c-x.md', 'README.md', '13-notes.txt'];
    expect(nameOfTicket(files, '12')).toBe('12-login');
    expect(nameOfTicket(files, '15c')).toBe('15c-x');
    expect(nameOfTicket(files, '15')).toBeUndefined();
    expect(nameOfTicket(files, '13')).toBeUndefined();
    expect(nameOfTicket(files, '1')).toBe('1-a');
  });

  it('is built once its file has a Result section', () => {
    expect(hasResult('# 12\n\n## Result\nok')).toBe(true);
    expect(hasResult('# 12\n\n## Result \t\r\nok')).toBe(true);
    expect(hasResult('# 12\n\n## Results\n')).toBe(false);
    expect(hasResult('# 12\n\n ## Result\n')).toBe(false);
  });

  it('names the family that built its last round in the last Builder line of the last Result', () => {
    expect(builderIn('Builder: early\n## Result\nBuilder: local\nRound: 1\n## Result\nBuilder: cloud-model \r\n')).toBe('cloud-model');
    expect(builderIn('## Result\nBuilder: local\nBuilder: other\n')).toBe('other');
    expect(builderIn('Builder: local\n')).toBeUndefined();
    expect(builderIn('## Result\nno builder\n')).toBeUndefined();
    expect(builderIn('## Result\nBuilder: two words\n')).toBeUndefined();
    expect(builderIn('## Result\n Builder: local\n')).toBeUndefined();
    expect(builderIn('## Result\nBuilder:\t local\n')).toBe('local');
  });

  it('names its round in the last Round line of the last Result, 1 by default', () => {
    expect(roundIn('## Result\nRound: 2\nRound: 3\n')).toBe('3');
    expect(roundIn('Round: 4\n## Result\nBuilder: x\n')).toBe('1');
    expect(roundIn('Round: 4\n')).toBe('1');
    expect(roundIn('## Result\nRound:\t 12\nnot Round: 9\n')).toBe('12');
  });
});
