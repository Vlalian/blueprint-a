// Fixtures for the research gate's tests: a claims file the gate passes, and the repo files its
// citations point at. Each test breaks one thing in it.

export const GOOD_CLAIMS = `Research: How does the sample project count words?
Date: 2026-10-04
Status: complete

## Answer
It does not yet: no word-counting module exists, and the only module is is-even.

## Claims
| ID | Tier | Claim | Source | Quote | Date |
|---|---|---|---|---|---|
| C1 | Direct | The only source module is is-even | \`src/is-even.ts:1\` | \`export function isEven(n: number): boolean\` | 2026-10-04 |
| C2 | Supported | Typecheck covers src only | tsconfig.json:9-10 | "include": ["src"] | 2026-10-04 |
| C3 | Direct | String match returns null when nothing matches | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match | "null if no matches are found" | 2026-10-04 |
| C4 | Inferred | A new module would follow the is-even style | src/is-even.ts:1 | - | 2026-10-04 |
| C5 | Unknown | Whether a word-count ticket was tried before | - | - | 2026-10-04 |

## Gaps
- The tracker's closed tickets were not searched.
`;

export const REPO_FILES: Record<string, string> = {
  'src/is-even.ts': 'export function isEven(n: number): boolean {\n  return n % 2 === 0;\n}\n',
  'tsconfig.json': '{\n  "compilerOptions": {\n    "module": "NodeNext",\n    "moduleResolution": "NodeNext",\n    "strict": true,\n    "noEmit": true,\n    "allowImportingTsExtensions": true\n  },\n  "include": ["src"]\n}\n',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match':
    '<html><body><h2>Return value</h2><p>An <code>Array</code> whose contents depend on the presence or absence of the global flag, or <code>null</code> if no matches are found.</p></body></html>',
};
