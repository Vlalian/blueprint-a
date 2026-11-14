// A claims file the claims parser and the plan gate's fact lint pass. Each test breaks one thing in it.

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
