import { describe, expect, it } from 'vitest';
import { licenceGate, type LicenceIo } from './gate.ts';

const views: Record<string, object> = {
  jscpd: { license: 'MIT', 'repository.url': 'git+https://github.com/kucherenko/jscpd.git', name: 'jscpd' },
  '@scope/gpl-tool': { license: 'GPL-3.0', 'repository.url': 'git+https://github.com/x/gpl-tool.git', name: '@scope/gpl-tool' },
};

function fakeIo() {
  const asked: string[] = [];
  const io: LicenceIo = { npmView: (name) => (asked.push(name), JSON.stringify(views[name] ?? {})) };
  return { io, asked };
}

describe('licenceGate', () => {
  it('passes a permissive package from the expected repository and reports its facts', () => {
    const { io, asked } = fakeIo();
    expect(licenceGate({ package: ['jscpd=github.com/kucherenko/jscpd'] }, io)).toEqual({
      gate: 'licence',
      pass: true,
      packages: [{ name: 'jscpd', license: 'MIT', repository: 'git+https://github.com/kucherenko/jscpd.git' }],
      findings: [],
    });
    expect(asked).toEqual(['jscpd']);
  });

  it('fails a copyleft package and names the finding', () => {
    const { io } = fakeIo();
    const r = licenceGate({ package: ['jscpd=github.com/kucherenko/jscpd', '@scope/gpl-tool=github.com/x/gpl-tool'] }, io);
    expect(r.pass).toBe(false);
    expect(r.findings).toEqual([
      '@scope/gpl-tool: licence "GPL-3.0" is not on the allowlist (MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD)',
    ]);
  });

  it('fails a package whose registry entry declares nothing', () => {
    const { io } = fakeIo();
    const r = licenceGate({ package: ['unknown-tool=github.com/x/unknown-tool'] }, io);
    expect(r.packages).toEqual([{ name: 'unknown-tool', license: undefined, repository: undefined }]);
    expect(r.findings).toEqual(['unknown-tool: no licence declared']);
  });

  it('cannot run without a package, or with an argument that is not <name>=<repo>', () => {
    const { io } = fakeIo();
    expect(() => licenceGate({}, io)).toThrow(/^usage: licence --package <name>=<expected repo substring>/);
    expect(() => licenceGate({ package: [] }, io)).toThrow(/^usage:/);
    expect(() => licenceGate({ package: ['jscpd'] }, io)).toThrow(/^usage:/);
    expect(() => licenceGate({ package: ['jscpd='] }, io)).toThrow(/^usage:/);
  });

  it('refuses a name that is not an npm package name before it reaches a shell', () => {
    const { io, asked } = fakeIo();
    expect(() => licenceGate({ package: ['x & echo hi=github.com/x'] }, io)).toThrow('not an npm package name: "x & echo hi"');
    expect(() => licenceGate({ package: ['=github.com/x'] }, io)).toThrow('not an npm package name: ""');
    expect(() => licenceGate({ package: ['Jscpd=github.com/x'] }, io)).toThrow(/not an npm package name/);
    expect(() => licenceGate({ package: ['@scope=github.com/x'] }, io)).toThrow(/not an npm package name/);
    expect(asked).toEqual([]);
  });

  it('keeps everything after the first = as the expected repository', () => {
    const { io } = fakeIo();
    expect(licenceGate({ package: ['jscpd=a=b'] }, io).findings).toEqual([
      'jscpd: repository git+https://github.com/kucherenko/jscpd.git is not the expected a=b',
    ]);
  });
});
