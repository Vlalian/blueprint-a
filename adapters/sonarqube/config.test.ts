import { describe, expect, it } from 'vitest';
import { sonarConfigOf, sonarRefOf, TOKEN_VARIABLE } from './config.ts';

describe('sonarConfigOf', () => {
  it('reads the server and project key from the project config, the server without its trailing slash', () => {
    expect(sonarConfigOf({ server: 'https://sonar.example.test/', projectKey: 'fabrikam-web', other: 1 })).toEqual({ server: 'https://sonar.example.test', projectKey: 'fabrikam-web' });
    expect(sonarConfigOf({ server: 'https://sonar.example.test/sonar', projectKey: 'k' })).toEqual({ server: 'https://sonar.example.test/sonar', projectKey: 'k' });
  });

  it('could not run without a sonarqube block, naming it', () => {
    expect(() => sonarConfigOf(undefined)).toThrow('the project config has no "sonarqube" block: it needs "server" (the SonarQube address) and "projectKey"');
  });

  it.each([
    [{ projectKey: 'k' }, '"sonarqube" needs "server" (the SonarQube address)'],
    [{ server: '', projectKey: 'k' }, '"sonarqube" needs "server" (the SonarQube address)'],
    [{ server: 7, projectKey: 'k' }, '"sonarqube" needs "server" (the SonarQube address)'],
    [{ server: 'https://sonar.example.test' }, '"sonarqube" needs "projectKey" (the project key in SonarQube)'],
    [{ server: 'https://sonar.example.test', projectKey: '' }, '"sonarqube" needs "projectKey" (the project key in SonarQube)'],
    [{ server: 'https://sonar.example.test', projectKey: 7 }, '"sonarqube" needs "projectKey" (the project key in SonarQube)'],
  ])('could not run with %j, naming what is missing', (block, error) => {
    expect(() => sonarConfigOf(block)).toThrow(new Error(error));
  });

  it.each(['sonar.example.test', 'ftp://x', 'xhttps://sonar.example.test', 'https:/sonar.example.test', 'https//sonar.example.test', 'httpss://x'])('names the server it wants as an http(s) address, not %s', (server) => {
    expect(() => sonarConfigOf({ server, projectKey: 'k' })).toThrow(new Error(`"sonarqube" needs "server" (an http or https address), not ${JSON.stringify(server)}`));
  });

  it('takes http and https, and drops every trailing slash', () => {
    expect(sonarConfigOf({ server: 'http://localhost:9000', projectKey: 'k' }).server).toBe('http://localhost:9000');
    expect(sonarConfigOf({ server: 'https://sonar.example.test//', projectKey: 'k' }).server).toBe('https://sonar.example.test');
  });
});

describe('sonarRefOf', () => {
  it('is the pull request when one is given, else the branch', () => {
    expect(sonarRefOf({ pr: '42', branch: 'ticket/07' })).toEqual({ pullRequest: '42' });
    expect(sonarRefOf({ branch: 'main' })).toEqual({ branch: 'main' });
  });

  it('carries the scanner’s task with a pull request, never an empty one, and never with a branch', () => {
    expect(sonarRefOf({ pr: '42', task: 'AZJ3' })).toEqual({ pullRequest: '42', task: 'AZJ3' });
    expect(sonarRefOf({ pr: '42', task: '' })).toEqual({ pullRequest: '42' });
    expect(sonarRefOf({ branch: 'dev', task: 'AZJ3' })).toEqual({ branch: 'dev' });
  });

  it('could not run with neither', () => {
    expect(() => sonarRefOf({})).toThrow('name the pull request (--pr <id>) or the branch (--branch <name>) SonarQube analysed');
    expect(() => sonarRefOf({ pr: '', branch: '' })).toThrow(/^name the pull request/);
  });
});

it('reads the token from SONAR_TOKEN, the variable SonarSource’s scanners use', () => {
  expect(TOKEN_VARIABLE).toBe('SONAR_TOKEN');
});
