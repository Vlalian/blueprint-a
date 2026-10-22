import { describe, expect, it } from 'vitest';
import { DEFAULTS, matchesAny, matchesPath, parseRunnerConfig } from './runner-config.ts';

describe('parseRunnerConfig: config/runner.json over the documented defaults', () => {
  it('gives the defaults when there is no file, or an empty object', () => {
    expect(parseRunnerConfig(undefined)).toBe(DEFAULTS);
    expect(parseRunnerConfig('{}')).toEqual(DEFAULTS);
  });

  it('defaults to main, a CRAP limit of 6 and the lockfile as whole-suite ground', () => {
    expect(DEFAULTS).toMatchObject({ integrationBranch: 'main', crapLimit: 6, strykerConfig: 'config/runner.json' });
    expect(DEFAULTS.wholeSuite).toContain('package-lock.json');
    expect(DEFAULTS.report).toEqual({ dir: 'gate-reports', trusted: ['mutation'], ungraded: ['docs/'], env: 'CI', name: '{branch}.gate.json' });
    expect(DEFAULTS.mergeCheck).toBe('');
    expect(DEFAULTS).toMatchObject({ sourceDirs: ['src'], graphDirs: ['src', 'test'], envFile: '', checks: {}, alwaysRun: [], stateDir: 'state', busyLock: 'runner.lock', exempt: [], sandboxIgnore: [] });
  });

  it('takes each field the file sets, merging an object field over its default', () => {
    const text = JSON.stringify({ integrationBranch: 'develop', sourceDirs: ['lib'], crapLimit: 4, report: { dir: 'ci' }, checks: { lint: 'npm run lint' } });
    const c = parseRunnerConfig(text);
    expect(c).toMatchObject({ integrationBranch: 'develop', sourceDirs: ['lib'], crapLimit: 4, checks: { lint: 'npm run lint' } });
    expect(c.report).toEqual({ dir: 'ci', trusted: ['mutation'], ungraded: ['docs/'], env: 'CI', name: '{branch}.gate.json' });
    expect(parseRunnerConfig('{"report":{"name":"ci-{branch}.json"}}').report.name).toBe('ci-{branch}.json');
    expect(c.integrationTests).toEqual(DEFAULTS.integrationTests);
    expect(c.alwaysRun).toEqual([]);
  });

  it('ignores a field it does not know', () => {
    expect(parseRunnerConfig('{"$comment":"x","other":1}')).toEqual(DEFAULTS);
  });

  it('refuses a field of the wrong type, naming it', () => {
    expect(() => parseRunnerConfig('{"crapLimit":"6"}')).toThrow('config/runner.json: crapLimit is not a number');
    expect(() => parseRunnerConfig('{"sourceDirs":"src"}')).toThrow('config/runner.json: sourceDirs is not a list of strings');
    expect(() => parseRunnerConfig('{"sourceDirs":["src",1]}')).toThrow('sourceDirs is not a list of strings');
    expect(() => parseRunnerConfig('{"report":{"trusted":"mutation"}}')).toThrow('config/runner.json: report.trusted is not a list of strings');
    expect(() => parseRunnerConfig('{"report":[]}')).toThrow('config/runner.json: report is not an object');
    expect(() => parseRunnerConfig('{"report":null}')).toThrow('report is not an object');
    expect(() => parseRunnerConfig('{"checks":{"lint":1}}')).toThrow('config/runner.json: checks is not an object');
    expect(() => parseRunnerConfig('{"checks":{"lint":"x","b":1}}')).toThrow('config/runner.json: checks is not an object');
    expect(() => parseRunnerConfig('{"envFile":3}')).toThrow('envFile is not a string');
    expect(() => parseRunnerConfig('{"report":{"name":2}}')).toThrow('config/runner.json: report.name is not a string');
  });

  it('refuses a report name without {branch}, which would give every branch one file', () => {
    expect(() => parseRunnerConfig('{"report":{"name":"gate.json"}}')).toThrow('config/runner.json: report.name has no {branch}');
    expect(() => parseRunnerConfig('{"report":{"name":"{Branch}.json"}}')).toThrow('report.name has no {branch}');
  });

  it('refuses a file that is not JSON, or not an object', () => {
    expect(() => parseRunnerConfig('{')).toThrow('config/runner.json is not JSON');
    expect(() => parseRunnerConfig('[]')).toThrow('config/runner.json is not a JSON object');
    expect(() => parseRunnerConfig('null')).toThrow('config/runner.json is not a JSON object');
  });
});

describe('matchesPath: folders, names and stars', () => {
  it.each([
    ['config/x.json', 'config/', true],
    ['configs/x.json', 'config/', false],
    ['a/config/x.json', 'config/', false],
    ['package-lock.json', 'package-lock.json', true],
    ['a/package-lock.json', 'package-lock.json', false],
    ['package-lockXjson', 'package-lock.json', false],
    ['tsconfig.build.json', 'tsconfig*.json', true],
    ['tsconfig.json', 'tsconfig*.json', true],
    ['tsconfig/a.json', 'tsconfig*.json', false],
    ['xtsconfig.json', 'tsconfig*.json', false],
    ['tsconfig.json.bak', 'tsconfig*.json', false],
    ['a(b).ts', 'a(b).ts', true],
  ])('%s against %s: %s', (path, pattern, expected) => {
    expect(matchesPath(path, pattern)).toBe(expected);
  });

  it('matchesAny: any pattern of the list', () => {
    expect(matchesAny('docs/a.md', ['x/', 'docs/'])).toBe(true);
    expect(matchesAny('src/a.ts', ['x/', 'docs/'])).toBe(false);
    expect(matchesAny('src/a.ts', [])).toBe(false);
  });
});
