import { describe, expect, it } from 'vitest';
import { prConfigOf, stagingOf } from './staging.ts';

const PR = { remote: 'origin', base: 'main', watchMinutes: 30 };

describe('stagingOf (phase 2 decision 22)', () => {
  it('reads the integration branch, the branch it is promoted to and the staging URL', () => {
    expect(stagingOf({ integrationBranch: 'dev', promoteTo: 'main', stagingUrl: 'https://staging.example' })).toEqual({ integrationBranch: 'dev', promoteTo: 'main', url: 'https://staging.example' });
    expect(stagingOf({ integrationBranch: 'dev', promoteTo: 'main' })).toEqual({ integrationBranch: 'dev', promoteTo: 'main', url: undefined });
  });

  it('is off for a project that names neither', () => {
    expect(stagingOf({})).toBeUndefined();
  });

  it.each([
    [{ integrationBranch: 'dev' }],
    [{ promoteTo: 'main' }],
    [{ integrationBranch: '', promoteTo: 'main' }],
    [{ integrationBranch: 'dev', promoteTo: 3 }],
  ])('refuses half a staging config: %j', (config) => {
    expect(() => stagingOf(config)).toThrow('project.json needs both "integrationBranch" and "promoteTo" (branch names), or neither');
  });

  it('refuses an integration branch that is the branch it is promoted to', () => {
    expect(() => stagingOf({ integrationBranch: 'main', promoteTo: 'main' })).toThrow('"integrationBranch" and "promoteTo" are both main: work would land in production unreviewed');
  });

  it('refuses a staging URL that is not text', () => {
    expect(() => stagingOf({ integrationBranch: 'dev', promoteTo: 'main', stagingUrl: 3 })).toThrow('"stagingUrl" is not a URL');
  });
});

describe('prConfigOf', () => {
  it('opens draft PRs against the integration branch, never the branch it is promoted to', () => {
    expect(prConfigOf({ pr: PR, integrationBranch: 'dev', promoteTo: 'main' })).toEqual({ remote: 'origin', base: 'dev', watchMinutes: 30, promoteTo: 'main' });
  });

  it('keeps the pr config as it is without staging, and is off without one', () => {
    expect(prConfigOf({ pr: PR })).toEqual(PR);
    expect(prConfigOf({ integrationBranch: 'dev', promoteTo: 'main' })).toBeUndefined();
  });
});
