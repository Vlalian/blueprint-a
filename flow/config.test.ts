import { describe, expect, it } from 'vitest';
import { DEFAULTS, parseFlowConfig } from './config.ts';

const local = { name: 'local', build: 'agent build {prompt}', review: 'agent review {prompt}' };
const parse = (value: object) => parseFlowConfig(JSON.stringify(value));

describe('the flow configuration', () => {
  it('is every default without a file or for an empty object', () => {
    expect(parseFlowConfig(undefined)).toBe(DEFAULTS);
    expect(parse({})).toEqual(DEFAULTS);
  });

  it('has the documented defaults', () => {
    expect(DEFAULTS).toEqual({
      integrationBranch: 'main',
      buildCap: 3,
      owner: 'the owner',
      ticketFolder: 'docs/tickets',
      branchPrefix: 'ticket/',
      remote: 'origin',
      stateDir: 'state/flow',
      worktreeDir: '.worktrees',
      host: { host: 'github' },
      families: [],
      gate: ['npm run gate -- --base {base} --merge {branch}'],
      checks: ['npx tsc --noEmit', 'npx vitest run'],
      typecheck: 'npx tsc --noEmit',
      afterMerge: { commands: [], add: [] },
      decisions: 'state/decisions.json',
      pendingFolder: 'state/approvals/pending',
      directivesFile: 'AGENTS.md',
      skillsFolder: 'skills',
    });
  });

  it('takes each field the file sets and keeps the defaults of the rest', () => {
    const c = parse({ integrationBranch: 'develop', buildCap: 2, owner: 'Ana', gate: ['make gate'], checks: [], afterMerge: { add: ['x.json'] } });
    expect(c).toEqual({ ...DEFAULTS, integrationBranch: 'develop', buildCap: 2, owner: 'Ana', gate: ['make gate'], checks: [], afterMerge: { commands: [], add: ['x.json'] } });
  });

  it('runs no after-merge command and adds no file unless the file names them', () => {
    expect(parse({ afterMerge: { commands: ['make registry'] } }).afterMerge).toEqual({ commands: ['make registry'], add: [] });
    expect(parse({ afterMerge: {} }).afterMerge).toEqual({ commands: [], add: [] });
  });

  it('reads the families, each with an hour as its timeout unless it names one', () => {
    expect(parse({ families: [local, { ...local, name: 'cloud', timeoutMs: 60_000 }] }).families).toEqual([
      { ...local, timeoutMs: 3_600_000 },
      { ...local, name: 'cloud', timeoutMs: 60_000 },
    ]);
  });

  it.each([
    ['not a list', { families: local }],
    ['a family without a name', { families: [{ ...local, name: undefined }] }],
    ['a blank build command', { families: [{ ...local, build: ' ' }] }],
    ['a review command that is no string', { families: [{ ...local, review: 3 }] }],
    ['a timeout of 0', { families: [{ ...local, timeoutMs: 0 }] }],
    ['a fractional timeout', { families: [{ ...local, timeoutMs: 1.5 }] }],
    ['two families of one name', { families: [local, local] }],
    ['a family that is no object', { families: [null] }],
  ])('refuses families with %s', (_, value) => {
    expect(() => parse(value)).toThrow('config/flow.json: families is not a list of {name, build, review, timeoutMs?} with distinct names');
  });

  it.each([
    [{ buildCap: 0 }, 'buildCap is not a whole number above 0'],
    [{ buildCap: '3' }, 'buildCap is not a whole number above 0'],
    [{ gate: 'npm run gate' }, 'gate is not a list of strings'],
    [{ checks: [1] }, 'checks is not a list of strings'],
    [{ owner: 1 }, 'owner is not a string'],
    [{ integrationBranch: ['main'] }, 'integrationBranch is not a string'],
    [{ afterMerge: { commands: 'x' } }, 'afterMerge is not an object of {commands, add}, each a list of strings'],
    [{ afterMerge: { add: [2] } }, 'afterMerge is not an object of {commands, add}, each a list of strings'],
  ])('names the field of the wrong type: %j', (value, says) => {
    expect(() => parse(value)).toThrow(`config/flow.json: ${says}`);
  });

  it('reads the host as adapters/host does, Azure DevOps with its project', () => {
    const host = { host: 'azure-devops', organization: 'org', project: 'proj', repository: 'repo' };
    expect(parse({ host }).host).toEqual(host);
    expect(() => parse({ host: { host: 'gitlab' } })).toThrow('config/flow.json: host: "pr" "host" is github or azure-devops, not "gitlab"');
  });

  it.each([
    ['{', 'config/flow.json is not JSON'],
    ['[]', 'config/flow.json is not a JSON object'],
    ['null', 'config/flow.json is not a JSON object'],
    ['"x"', 'config/flow.json is not a JSON object'],
  ])('refuses %s', (text, says) => {
    expect(() => parseFlowConfig(text)).toThrow(says);
  });
});
