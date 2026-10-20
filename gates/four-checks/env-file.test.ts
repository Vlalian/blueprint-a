import { describe, expect, it } from 'vitest';
import { envFileOf, parseEnvFile, redact, withEnvFile, type EnvRunner } from './env-file.ts';

// The @ is joined in so the password and host never read as an email address in this file.
const URL = ['postgresql://pilot:pw', 'ep-pilot-1.example.neon.tech/neondb?sslmode=require'].join('@');

describe('envFileOf', () => {
  it('is neon.envFile, else .env.local', () => {
    expect(envFileOf({ neon: { envFile: '.env.test.local' } })).toBe('.env.test.local');
    expect(envFileOf({ neon: {} })).toBe('.env.local');
    expect(envFileOf({})).toBe('.env.local');
  });
});

describe('parseEnvFile', () => {
  it('reads KEY=VALUE lines and skips comments, blanks and lines that set nothing', () => {
    const text = ['# the run’s branch', '', `DATABASE_URL=${URL}`, '   ', 'not a line', '=no-key', '2FA=no', 'A_1=x=y', '  # DATABASE_URL=commented'].join('\n');
    expect(parseEnvFile(text)).toEqual({ DATABASE_URL: URL, A_1: 'x=y' });
  });

  it('trims space around the key and the value, and CRLF line ends', () => {
    expect(parseEnvFile('  KEY  =  value  \r\nNEXT=1\r\n')).toEqual({ KEY: 'value', NEXT: '1' });
  });

  it('takes off one pair of matching quotes, and keeps a quote that is not closed', () => {
    expect(parseEnvFile(`A="quoted value"\nB='single'\nC="open\nD='mixed"\nE=""\nF="\nG=a"b"\nH="a"b`)).toEqual({ A: 'quoted value', B: 'single', C: '"open', D: `'mixed"`, E: '', F: '"', G: 'a"b"', H: '"a"b' });
  });

  it('is empty without a file; a later line wins', () => {
    expect(parseEnvFile(undefined)).toEqual({});
    expect(parseEnvFile('A=1\nA=2\n')).toEqual({ A: '2' });
  });
});

describe('redact', () => {
  it("replaces every value of 8 or more characters with the variable's name", () => {
    const vars = { DATABASE_URL: URL, PORT: '3000', SHORT: '1234567', EIGHT: '12345678' };
    expect(redact(`connecting to ${URL}\nagain ${URL} on 3000 1234567 12345678\n`, vars)).toBe('connecting to [env:DATABASE_URL]\nagain [env:DATABASE_URL] on 3000 1234567 [env:EIGHT]\n');
  });

  it('replaces the longer of two values that overlap first', () => {
    expect(redact('secret-value-long', { A: 'secret-value', B: 'secret-value-long' })).toBe('[env:B]');
    expect(redact('secret-value-long', { B: 'secret-value-long', A: 'secret-value' })).toBe('[env:B]');
  });

  it('leaves output without values alone', () => {
    expect(redact('all green\n', {})).toBe('all green\n');
  });
});

describe('withEnvFile', () => {
  it("runs each check with the env file's variables and keeps their values out of its output", () => {
    const seen: unknown[] = [];
    const run: EnvRunner = (command, cwd, env) => (seen.push([command, cwd, env]), { exitCode: 1, output: `DATABASE_URL is ${env.DATABASE_URL}\n` });
    const vars = { DATABASE_URL: URL };
    expect(withEnvFile(vars, run)('npm test', '/wt')).toEqual({ exitCode: 1, output: 'DATABASE_URL is [env:DATABASE_URL]\n' });
    expect(seen).toEqual([['npm test', '/wt', vars]]);
  });
});
