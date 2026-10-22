import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import integrationConfig from '../vitest.integration.config.ts';
import { MIN_SPAWN_TIMEOUT_MS, spawnTimeoutFindings, spawns } from './spawn-timeouts.ts';

const ROOT = resolve(import.meta.dirname, '..');

const HOOK_PROBLEM = 'a test file that spawns a process gives this hook a timeout of at least 60 s, or sets hookTimeout >= 60 s for the file (vi.setConfig)';
const TEST_PROBLEM = 'a test file that spawns a process gives this test a timeout of at least 60 s, or sets testTimeout >= 60 s for the file (vi.setConfig)';
const CONFIG_PROBLEM = 'a test file that spawns a process never sets a timeout below 60 s';

// A fixture test that spawns git: the shape the check exists for.
const GIT = `import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('reads the git version', () => {
  expect(spawnSync('git', ['--version']).status).toBe(0);
}TIMEOUT);
`;
const gitTest = (timeout: string) => GIT.replace('TIMEOUT', timeout);

describe('spawnTimeoutFindings — a spawning test never races a few seconds', () => {
  it('fails a fixture test that spawns git with the default timeout, and passes it once the timeout is 60 s', () => {
    expect(MIN_SPAWN_TIMEOUT_MS).toBe(60_000);
    expect(spawnTimeoutFindings('a.test.ts', gitTest(''), [])).toEqual([`a.test.ts:4 ${TEST_PROBLEM}`]);
    expect(spawnTimeoutFindings('a.test.ts', gitTest(', 59_999'), [])).toEqual([`a.test.ts:4 ${CONFIG_PROBLEM} (59999 ms)`]);
    expect(spawnTimeoutFindings('a.test.ts', gitTest(', 60_000'), [])).toEqual([]);
  });

  it('takes the timeout from an options object, before or after the body', () => {
    expect(spawnTimeoutFindings('a.test.ts', GIT.replace("it('reads the git version', ", "it('reads', { timeout: 60_000 }, ").replace('TIMEOUT', ''), [])).toEqual([]);
    expect(spawnTimeoutFindings('a.test.ts', gitTest(', { timeout: 120_000 }'), [])).toEqual([]);
    expect(spawnTimeoutFindings('a.test.ts', gitTest(', { retry: 2 }'), [])).toEqual([`a.test.ts:4 ${TEST_PROBLEM}`]);
    // Only a plain key is read, the way vitest's options are written.
    expect(spawnTimeoutFindings('a.test.ts', gitTest(", { 'timeout': 60_000 }"), [])).toEqual([`a.test.ts:4 ${TEST_PROBLEM}`]);
    expect(spawnTimeoutFindings('a.test.ts', gitTest(', { timeout: 5_000 }'), [])).toEqual([`a.test.ts:4 ${CONFIG_PROBLEM} (5000 ms)`]);
  });

  it('reads a timeout held in a constant of the file', () => {
    const slow = `const SLOW = 90_000;\nconst FAST = 1_000;\n${GIT}`;
    expect(spawnTimeoutFindings('a.test.ts', slow.replace('TIMEOUT', ', SLOW'), [])).toEqual([]);
    expect(spawnTimeoutFindings('a.test.ts', slow.replace('TIMEOUT', ', FAST'), [])).toEqual([`a.test.ts:6 ${CONFIG_PROBLEM} (1000 ms)`]);
    expect(spawnTimeoutFindings('a.test.ts', slow.replace('TIMEOUT', ', UNKNOWN'), [])).toEqual([`a.test.ts:6 ${TEST_PROBLEM}`]);
  });

  it('accepts one setting for the whole file, tests and hooks each by their own key', () => {
    const suite = (config: string) => `${GIT.replace('TIMEOUT', '')}vi.setConfig(${config});\nbeforeAll(() => {});\n`;
    expect(spawnTimeoutFindings('a.test.ts', suite('{ testTimeout: 60_000, hookTimeout: 60_000 }'), [])).toEqual([]);
    expect(spawnTimeoutFindings('a.test.ts', suite('{ testTimeout: 60_000 }'), [])).toEqual([`a.test.ts:8 ${HOOK_PROBLEM}`]);
    expect(spawnTimeoutFindings('a.test.ts', suite('{ hookTimeout: 60_000 }'), [])).toEqual([`a.test.ts:4 ${TEST_PROBLEM}`]);
    expect(spawnTimeoutFindings('a.test.ts', suite('{ testTimeout: 30_000, hookTimeout: 60_000 }'), [])).toEqual([
      `a.test.ts:4 ${TEST_PROBLEM}`,
      `a.test.ts:7 ${CONFIG_PROBLEM} (30000 ms)`,
    ]);
    expect(spawnTimeoutFindings('a.test.ts', suite('config'), [])).toEqual([`a.test.ts:4 ${TEST_PROBLEM}`, `a.test.ts:8 ${HOOK_PROBLEM}`]);
  });

  it("counts the timeouts its vitest config sets for every file, which the file's own setting overrides", () => {
    const src = `${GIT.replace('TIMEOUT', '')}beforeAll(() => {});\n`;
    expect(spawnTimeoutFindings('a.test.ts', src, [], { test: 600_000, hook: 300_000 })).toEqual([]);
    expect(spawnTimeoutFindings('a.test.ts', src, [], { test: 600_000, hook: 59_999 })).toEqual([`a.test.ts:7 ${HOOK_PROBLEM}`]);
    expect(spawnTimeoutFindings('a.test.ts', src, [], { test: 30_000 })).toEqual([`a.test.ts:4 ${TEST_PROBLEM}`, `a.test.ts:7 ${HOOK_PROBLEM}`]);
    const own = `${src}vi.setConfig({ testTimeout: 60_000, hookTimeout: 5_000 });\n`;
    expect(spawnTimeoutFindings('a.test.ts', own, [], { test: 30_000, hook: 300_000 })).toEqual([`a.test.ts:7 ${HOOK_PROBLEM}`, `a.test.ts:8 ${CONFIG_PROBLEM} (5000 ms)`]);
  });

  it('still holds a test or hook to its own timeout when the file sets one', () => {
    const src = `${GIT.replace('TIMEOUT', ', 10_000')}vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });\nbeforeEach(() => {}, 2_000);\n`;
    expect(spawnTimeoutFindings('a.test.ts', src, [])).toEqual([`a.test.ts:4 ${CONFIG_PROBLEM} (10000 ms)`, `a.test.ts:8 ${CONFIG_PROBLEM} (2000 ms)`]);
  });

  it('checks every kind of test and hook, each by its own line, inside describe blocks too', () => {
    const src = `import { execFileSync } from 'node:child_process';
describe('d', () => {
  beforeAll(() => {});
  afterAll(() => {});
  beforeEach(() => {});
  afterEach(() => {});
  test('t', () => {});
  it.each([1, 2])('e %s', () => {});
  it.skipIf(true)('s', () => {});
  it.only('o', () => {}, 60_000);
  test.each([1])('f', () => {}, 60_000);
  it.for([1])('g', () => {});
  test.runIf(true)('r', () => {});
  describe('inner', () => {});
});
execFileSync('git', ['status']);
`;
    expect(spawnTimeoutFindings('a.test.ts', src, [])).toEqual([
      `a.test.ts:3 ${HOOK_PROBLEM}`,
      `a.test.ts:4 ${HOOK_PROBLEM}`,
      `a.test.ts:5 ${HOOK_PROBLEM}`,
      `a.test.ts:6 ${HOOK_PROBLEM}`,
      `a.test.ts:7 ${TEST_PROBLEM}`,
      `a.test.ts:8 ${TEST_PROBLEM}`,
      `a.test.ts:9 ${TEST_PROBLEM}`,
      `a.test.ts:12 ${TEST_PROBLEM}`,
      `a.test.ts:13 ${TEST_PROBLEM}`,
    ]);
  });

  it('asks nothing of a test file that spawns nothing', () => {
    expect(spawnTimeoutFindings('a.test.ts', "import { it } from 'vitest';\nit('adds', () => {});\n", [])).toEqual([]);
    // An injected fake named like a spawner, with child_process never imported, spawns nothing.
    expect(spawnTimeoutFindings('a.test.ts', "it('fakes', () => { deps.spawnSync('git'); });\n", [])).toEqual([]);
    // Importing child_process for a type, without a call, spawns nothing either.
    expect(spawnTimeoutFindings('a.test.ts', "import type { SpawnSyncReturns } from 'node:child_process';\nit('x', () => {});\n", [])).toEqual([]);
  });

  it('counts a test as spawning when it imports a spawning helper from test/helpers', () => {
    const src = "import { fakeGh } from '../test/helpers/fake-gh.ts';\nit('opens a PR', () => {});\n";
    expect(spawnTimeoutFindings('scripts/a.test.ts', src, ['test/helpers/fake-gh.ts'])).toEqual([`scripts/a.test.ts:2 ${TEST_PROBLEM}`]);
    expect(spawnTimeoutFindings('scripts/a.test.ts', src, ['test/helpers/toy-canary.ts'])).toEqual([]);
    expect(spawnTimeoutFindings('gates/x/a.test.ts', src.replace('../', '../../'), ['test/helpers/fake-gh.ts'])).toEqual([`gates/x/a.test.ts:2 ${TEST_PROBLEM}`]);
    expect(spawnTimeoutFindings('test/helpers/a.test.ts', src.replace('../test/helpers/', './'), ['test/helpers/fake-gh.ts'])).toEqual([`test/helpers/a.test.ts:2 ${TEST_PROBLEM}`]);
  });
});

describe('spawns — what counts as starting a process', () => {
  it.each([
    "import { spawnSync } from 'node:child_process';\nspawnSync('git');",
    "import { spawn } from 'child_process';\nspawn('git');",
    "import { execFileSync } from 'node:child_process';\nconst f = () => execFileSync('git');",
    "import { execFile } from 'node:child_process';\nexecFile('git');",
    "import { execSync } from 'node:child_process';\nexecSync('git status');",
    "import * as cp from 'node:child_process';\ncp.spawnSync('git');",
  ])('a call to a child_process spawner: %s', (source) => {
    expect(spawns('a.test.ts', source)).toBe(true);
  });

  it.each([
    "import { spawnSync } from 'node:child_process';\nconst run = spawnSync;",
    "deps.spawnSync('git');",
    "import { join } from 'node:path';\nspawnSync('git');",
    "import { spawnSync } from 'node:child_process';\n// spawnSync('git');",
    "import { spawnSync } from 'node:child_process';\nconst s = \"spawnSync('git')\";",
    "import { spawnSync } from 'x/child_process';\nspawnSync('git');",
    "import { spawnSync } from 'child_process/x';\nspawnSync('git');",
  ])('no call to a child_process spawner: %s', (source) => {
    expect(spawns('a.test.ts', source)).toBe(false);
  });
});

function testFiles(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : testFiles(path, keep);
    return keep(e.name) ? [path] : [];
  });
}

const rel = (path: string) => relative(ROOT, path).split('\\').join('/');

describe('the load rule holds over the whole repo', () => {
  it('every test file that spawns a process gives each test and hook at least 60 s', () => {
    const helpers = testFiles(join(ROOT, 'test', 'helpers'), (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
      .filter((f) => spawns(rel(f), readFileSync(f, 'utf8')))
      .map(rel);
    // The helpers that spawn count for the tests that call them (this repo's fake gh, the merge gate's repo).
    expect(helpers.length).toBeGreaterThan(0);
    const files = ['gates', 'adapters', 'scripts', 'dispatcher', 'briefing', 'watchers', 'test', 'skills', 'runner'].filter((d) => existsSync(join(ROOT, d))).flatMap((d) => testFiles(join(ROOT, d), (n) => n.endsWith('.test.ts')));
    expect(files.filter((f) => spawns(rel(f), readFileSync(f, 'utf8'))).length).toBeGreaterThan(30);
    const config = integrationConfig.test!;
    const integration = { test: config.testTimeout, hook: config.hookTimeout };
    expect(integration.test).toBeGreaterThanOrEqual(60_000);
    const findings = files.flatMap((f) => spawnTimeoutFindings(rel(f), readFileSync(f, 'utf8'), helpers, f.endsWith('.integration.test.ts') ? integration : {}));
    expect(findings).toEqual([]);
    // It reads every test file in the repo: 35 s under a loaded merge gate with coverage (ticket 48 merge, 2026-10-05).
  }, 120_000);
});
