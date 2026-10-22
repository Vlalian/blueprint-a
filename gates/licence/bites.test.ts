// Prove the licence gate bites: an allowed licence from the expected repository passes, a
// copyleft one fails, and the allowed one passes again.
import { describe, expect, it } from 'vitest';
import { BITES, proveItBites } from '../../test/helpers/prove-it-bites.ts';
import { exitCodeFor, failClosed } from '../lib/contract.ts';
import { licenceGate } from './gate.ts';

describe('the licence gate bites', () => {
  it('passes an MIT package from its repository, fails it once it reads GPL-3.0, passes again once it is MIT', () => {
    let license = 'MIT';
    const view = () => JSON.stringify({ license, 'repository.url': 'git+https://github.com/acme/tool.git', name: 'tool' });
    const run = () => exitCodeFor(failClosed('licence', () => licenceGate({ package: ['tool=github.com/acme/tool'] }, { npmView: view })));
    expect(proveItBites({ run, inject: () => (license = 'GPL-3.0'), revert: () => (license = 'MIT') })).toEqual(BITES);
  });
});
