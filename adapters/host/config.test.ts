import { describe, expect, it } from 'vitest';
import { hostAdapterOf, hostAdapterOrFailure, hostConfigOf, type HostDeps } from './config.ts';

const AZURE = { host: 'azure-devops', organization: 'fabrikam', project: 'Fabrikam-Fiber', repository: 'fabrikam-web' };

describe('hostConfigOf', () => {
  it('is GitHub when the pr config names no host, or names github', () => {
    expect(hostConfigOf(undefined)).toEqual({ host: 'github' });
    expect(hostConfigOf({ remote: 'origin', base: 'dev' })).toEqual({ host: 'github' });
    expect(hostConfigOf({ host: 'github' })).toEqual({ host: 'github' });
  });

  it('reads Azure DevOps with its organisation, project and repository, nothing else', () => {
    expect(hostConfigOf({ ...AZURE, remote: 'origin', base: 'dev' })).toEqual(AZURE);
  });

  it.each(['organization', 'project', 'repository'])('refuses Azure DevOps without a %s', (field) => {
    expect(() => hostConfigOf({ ...AZURE, [field]: undefined })).toThrow(`"pr" with host azure-devops needs "${field}" (a name)`);
    expect(() => hostConfigOf({ ...AZURE, [field]: '' })).toThrow(`needs "${field}"`);
    expect(() => hostConfigOf({ ...AZURE, [field]: 7 })).toThrow(`needs "${field}"`);
  });

  it('refuses a host it does not know', () => {
    expect(() => hostConfigOf({ host: 'gitlab' })).toThrow('"pr" "host" is github or azure-devops, not "gitlab"');
  });
});

describe('hostAdapterOf', () => {
  const deps = (env: Record<string, string | undefined>): HostDeps & { used: string[] } => {
    const used: string[] = [];
    return {
      used,
      gh: () => (used.push('gh'), { status: 0, stdout: '{}', stderr: '' }),
      http: () => (used.push('http'), { status: 200, body: '{}' }),
      env,
    };
  };

  it('gives the GitHub adapter on gh for github', () => {
    expect(hostAdapterOf({ host: 'github' }, deps({})).host).toBe('github');
  });

  it('gives the Azure DevOps adapter on the HTTP client and the environment PAT for azure-devops', () => {
    const d = deps({ AZURE_DEVOPS_PAT: 'p' });
    const host = hostAdapterOf(hostConfigOf(AZURE), d);
    expect(host.host).toBe('azure-devops');
    expect(() => host.workItem(1)).toThrow();
    expect(d.used).toEqual(['http']);
  });

  it('could not run for azure-devops without the PAT', () => {
    expect(() => hostAdapterOf(hostConfigOf(AZURE), deps({}))).toThrow(/^AZURE_DEVOPS_PAT is not set/);
  });
});

describe('hostAdapterOrFailure', () => {
  const deps = (env: Record<string, string | undefined>): HostDeps => ({ gh: () => ({ status: 0, stdout: '{}', stderr: '' }), http: () => ({ status: 200, body: '{"value":[]}' }), env });

  it('is the adapter when it can be made', () => {
    expect(hostAdapterOrFailure({ host: 'github' }, deps({})).host).toBe('github');
    expect(hostAdapterOrFailure(hostConfigOf(AZURE), deps({ AZURE_DEVOPS_PAT: 'p' })).checksForCommit('a'.repeat(40)).state).toBe('pending');
  });

  it('without the PAT, fails every call naming the variable, and not before', () => {
    const host = hostAdapterOrFailure(hostConfigOf(AZURE), deps({}));
    expect(host.host).toBe('azure-devops');
    const calls = [() => host.checksForCommit('a'.repeat(40)), () => host.openDraftPr('b', 'dev', 't', ''), () => host.prStatus('1'), () => host.workItem(1), () => host.setWorkItemState(1, 'Done')];
    for (const call of calls) expect(call).toThrow(/^AZURE_DEVOPS_PAT is not set/);
  });
});
