// Windows portability rules for this repo's own code, checked over every source and test file by
// portability.test.ts. The code runs for real on Windows 11 with Node 24; each rule is a way a
// file that passes on Linux breaks there.

// A value holding a path: what join, resolve or dirname returns, or a variable named for one. A name in
// capitals is a constant the test wrote itself, already in the '/' form the code under test reads.
const PATH = /(?:(?<![\w.])(?:path\.)?(?:join|resolve|dirname)\([^)]*\)|(?<![\w$.])(?=[a-z])[\w.]*?(?:[dD]ir|[pP]ath|[rR]oot|[fF]older)\w*)/
  .source;

const isTestFile = (path: string) => path.endsWith('.test.ts');
const all = () => true;
const source = (path: string) => !isTestFile(path);
const testOrHelper = (path: string) => isTestFile(path) || path.startsWith('test/helpers/');

const RULES: { pattern: RegExp; files: (path: string) => boolean; problem: string }[] = [
  {
    pattern: /\bprocess\.exit\s*\(/,
    files: all,
    problem: 'calling process.exit right after a write to a piped stdout crashes Node on Windows (exit 0xC0000409); set process.exitCode',
  },
  {
    pattern: /\b(?:spawnSync|spawn|execFileSync|execFile)\(\s*(['"`])(?:npx|npm|pnpm|yarn|[^'"`]*\.(?:cmd|bat))\1/,
    files: all,
    problem: 'npx, npm and .cmd/.bat files cannot be started without a shell on Windows; run process.execPath with the JS entry (gates/lib/node-bin.ts)',
  },
  {
    pattern: /(['"`])\/tmp\//,
    files: source,
    problem: 'there is no /tmp on Windows; use os.tmpdir()',
  },
  {
    // `${dir}/`, dir + '/', or dir.startsWith('a/'): a fake that matches the code's joined paths this way
    // finds nothing on Windows (ticket 53).
    pattern: new RegExp(`\\$\\{\\s*${PATH}\\s*\\}/|${PATH}\\s*\\+\\s*['"\`]/|${PATH}\\.(?:startsWith|endsWith|includes)\\(\\s*['"\`][^'"\`]*/`),
    files: testOrHelper,
    problem:
      "a '/' put onto a path matches nothing on Windows, where join gives '\\'; build it with join(dir, name), a prefix with dir + path.sep (or join(dir, 'x').slice(0, -1)), or compare after normalising with split(sep).join('/')",
  },
];

const isComment = (line: string) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

/** Each line of `source` that breaks a rule, as `path:line problem`. */
export function portabilityFindings(path: string, source: string): string[] {
  const rules = RULES.filter((rule) => rule.files(path));
  return source.split('\n').flatMap((line, i) =>
    isComment(line) ? [] : rules.filter((rule) => rule.pattern.test(line)).map((rule) => `${path}:${i + 1} ${rule.problem}`),
  );
}
