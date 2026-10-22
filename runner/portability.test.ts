import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portabilityFindings } from './portability.ts';

const ROOT = resolve(import.meta.dirname, '..');

// The forbidden shapes are built from parts, so this file does not break its own rules.
const EXIT = 'process.' + 'exit';
const SPAWN = 'spawn' + 'Sync';
const TMP = '/' + 'tmp/';

const EXIT_PROBLEM = 'calling process.exit right after a write to a piped stdout crashes Node on Windows (exit 0xC0000409); set process.exitCode';
const SHIM_PROBLEM =
  'npx, npm and .cmd/.bat files cannot be started without a shell on Windows; run process.execPath with the JS entry (gates/lib/node-bin.ts)';
const TMP_PROBLEM = 'there is no /tmp on Windows; use os.tmpdir()';
const SLASH_PROBLEM =
  "a '/' put onto a path matches nothing on Windows, where join gives '\\'; build it with join(dir, name), a prefix with dir + path.sep (or join(dir, 'x').slice(0, -1)), or compare after normalising with split(sep).join('/')";

describe('portabilityFindings — the Windows rules', () => {
  it(`finds ${EXIT}() anywhere, in a source file or a test's child command, and names the line`, () => {
    expect(portabilityFindings('a.ts', `const x = 1;\n${EXIT}(2);`)).toEqual([`a.ts:2 ${EXIT_PROBLEM}`]);
    expect(portabilityFindings('a.test.ts', `run('node -e "${EXIT} (1)"');`)).toEqual([`a.test.ts:1 ${EXIT_PROBLEM}`]);
  });

  it('allows process.exitCode, and a rule mentioned in a comment', () => {
    expect(portabilityFindings('a.ts', 'process.exitCode = 2;')).toEqual([]);
    expect(portabilityFindings('a.ts', `// never ${EXIT}() here\n/* ${EXIT}() */\n * ${EXIT}()`)).toEqual([]);
    expect(portabilityFindings('a.ts', `\t  // ${EXIT}()`)).toEqual([]);
  });

  it('reads a line as a comment only when it starts as one', () => {
    expect(portabilityFindings('a.ts', `${EXIT}(a * b); // done`)).toEqual([`a.ts:1 ${EXIT_PROBLEM}`]);
    expect(portabilityFindings('a.ts', `x; ${EXIT}(1) /* done */`)).toEqual([`a.ts:1 ${EXIT_PROBLEM}`]);
  });

  it('holds a test file to the shim rule too', () => {
    expect(portabilityFindings('a.test.ts', `${SPAWN}('npx', ['vitest'])`)).toEqual([`a.test.ts:1 ${SHIM_PROBLEM}`]);
  });

  const EXEC_FILE = 'exec' + 'File';
  it.each([`${SPAWN}('npx', ['tsc'])`, `${EXEC_FILE}Sync("npm", ['test'])`, `${SPAWN}( 'yarn')`, `${EXEC_FILE}(\`pnpm\`)`, `${'spawn'}('tool.cmd', [])`, `${SPAWN}('C:/x/run.bat')`])(
    'finds a shim started without a shell: %s',
    (line) => {
      expect(portabilityFindings('a.ts', line)).toEqual([`a.ts:1 ${SHIM_PROBLEM}`]);
    },
  );

  it.each([`${SPAWN}('git', ['status'])`, `${SPAWN}(process.execPath, ['npx'])`, `${SPAWN}('npxx')`, `${SPAWN}('a.cmdx')`, `${SPAWN}('npx" + "')`])(
    'leaves alone a command that is not a shim: %s',
    (line) => {
      expect(portabilityFindings('a.ts', line)).toEqual([]);
    },
  );

  it('finds a hard-coded /tmp/ path in source, but not in a test, where it only feeds a mock', () => {
    expect(portabilityFindings('a.ts', `const dir = '${TMP}x';`)).toEqual([`a.ts:1 ${TMP_PROBLEM}`]);
    expect(portabilityFindings('a.ts', `const dir = \`${TMP}\${x}\`;`)).toEqual([`a.ts:1 ${TMP_PROBLEM}`]);
    expect(portabilityFindings('a.test.ts', `mkdtempSync: () => '${TMP}x'`)).toEqual([]);
    expect(portabilityFindings('a.ts', `const dir = 'a${TMP}x';`)).toEqual([]);
  });

  // `${v}/` written as parts, so these lines are not themselves a slash appended to a path.
  const SL = '/';
  const slashAfter = (v: string) => '`$' + '{' + v + '}' + SL + '`';
  it.each([
    `p.startsWith(${slashAfter('dir')})`,
    `const key = ${slashAfter('tmpDir')} + name;`,
    `files.get(${slashAfter('w.root')}.concat(file))`,
    `seen(${slashAfter('join(a, b)')})`,
    `seen(${slashAfter(' path.resolve(a) ')})`,
    `seen(${slashAfter('dirname(file)')})`,
    `keys.filter((p) => p.startsWith(dir + '${SL}'))`,
    `const at = repoPath+"${SL}x";`,
    `const at = join(base, 'x') + \`${SL}\${name}\`;`,
    `if (path.includes('${SL}issues${SL}')) return x;`,
    `if (outFolder.endsWith("a${SL}")) return x;`,
    `if (root.startsWith(\`${SL}\`)) return x;`,
  ])('finds a slash put onto a path in a test fake: %s', (line) => {
    expect(portabilityFindings('a.test.ts', line)).toEqual([`a.test.ts:1 ${SLASH_PROBLEM}`]);
  });

  it('holds the test helpers to the slash rule, and leaves source alone, where joins are checked by their own tests', () => {
    const line = `p.startsWith(${slashAfter('dir')})`;
    expect(portabilityFindings('test/helpers/fake-x.ts', line)).toEqual([`test/helpers/fake-x.ts:1 ${SLASH_PROBLEM}`]);
    expect(portabilityFindings('scripts/x.ts', line)).toEqual([]);
    expect(portabilityFindings('scripts/test/helpers.ts', line)).toEqual([]);
  });

  it.each([
    `p.startsWith(join(dir, 'x').slice(0, -1))`,
    `files.get(join(dir, file))`,
    `p.split(sep).join('/').startsWith(prefix)`,
    `posix(dir).startsWith(top)`,
    `seen(${slashAfter('DIR')})`,
    `seen(${slashAfter('ROOT')})`,
    `seen(${slashAfter('ticket')})`,
    'seen(`$' + '{dir}-x/`)',
    `seen(${slashAfter('a.join(b)')})`,
    `const x = name + '/';`,
    `const x = dir + sep;`,
    `if (url.includes('/issues/')) return x;`,
    `if (path.includes('x')) return x;`,
    `if (path.startsWith(prefix)) return x;`,
    `if (path.match('/a/')) return x;`,
    `if (rootDir.startsWith('a'), '/') return x;`,
  ])('leaves alone a path built or matched portably: %s', (line) => {
    expect(portabilityFindings('a.test.ts', line)).toEqual([]);
  });

  it('refuses the ticket-53 fake, naming file and line, and passes its fix', () => {
    const fixture = (name: string) => readFileSync(join(ROOT, 'test', 'fixtures', 'portability', name), 'utf8');
    expect(portabilityFindings('scripts/tempo-main.test.ts', fixture('ticket-53-fake.txt'))).toEqual([`scripts/tempo-main.test.ts:19 ${SLASH_PROBLEM}`]);
    expect(portabilityFindings('scripts/tempo-main.test.ts', fixture('ticket-53-fixed.txt'))).toEqual([]);
  });

  it('names the portable forms in the finding', () => {
    expect(SLASH_PROBLEM).toContain('join(dir, name)');
    expect(SLASH_PROBLEM).toContain('path.sep');
    expect(SLASH_PROBLEM).toContain("split(sep).join('/')");
  });

  it('reports every rule a line breaks, and every line', () => {
    expect(portabilityFindings('a.ts', `${SPAWN}('npx'); ${EXIT}(1)\nok\n${EXIT}(0)`)).toEqual([
      `a.ts:1 ${EXIT_PROBLEM}`,
      `a.ts:1 ${SHIM_PROBLEM}`,
      `a.ts:3 ${EXIT_PROBLEM}`,
    ]);
  });
});

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : tsFiles(path);
    return e.name.endsWith('.ts') ? [path] : [];
  });
}

describe('the Windows sweep holds over the whole repo', () => {
  it('no source or test file breaks a portability rule', () => {
    const files = ['gates', 'adapters', 'scripts', 'dispatcher', 'briefing', 'watchers', 'test', 'skills', 'runner'].filter((d) => existsSync(join(ROOT, d))).flatMap((d) => tsFiles(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(100);
    const findings = files.flatMap((f) => portabilityFindings(relative(ROOT, f).split('\\').join('/'), readFileSync(f, 'utf8')));
    expect(findings).toEqual([]);
  });
});
