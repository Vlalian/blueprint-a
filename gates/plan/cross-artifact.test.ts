import { describe, expect, it } from 'vitest';
import { crossArtifact, mappedCriteria, namedPaths, ticketCriteria } from './cross-artifact.ts';
import { BROKEN, GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';

const exists = (p: string) => p === 'src/is-even.ts';
const messages = (plan: string, ticket = GOOD_TICKET) => crossArtifact(plan, ticket, exists).map((f) => f.message);

describe('ticketCriteria', () => {
  it('reads the bullet list under ## Acceptance criteria, without checkboxes', () => {
    expect(ticketCriteria(GOOD_TICKET)).toEqual([
      'When a title is given, the system shall return it lowercased with runs of other characters replaced by one hyphen.',
      'If the title is empty, then the system shall return an empty string.',
    ]);
  });

  it('reads indented and tightly written bullets, and skips lines that are not bullets', () => {
    const ticket = '## Acceptance criteria   \n  - Indented.\n-Tight.\n- [x]Checked.\nNote - not a bullet.\n### Sub-heading\n- After it.\n## Notes\n- Not a criterion.\n';
    expect(ticketCriteria(ticket)).toEqual(['Indented.', 'Tight.', 'Checked.', 'After it.']);
  });

  it('reads only a ## Acceptance criteria heading that starts a line', () => {
    expect(ticketCriteria('### Acceptance criteria\n- Not one.\n')).toEqual([]);
  });

  it('reads nothing from a ticket without the section', () => {
    expect(ticketCriteria('# 01 X\n\nStatus: ready-for-agent\n')).toEqual([]);
  });
});

describe('mappedCriteria', () => {
  it('reads each "criterion -> behaviors n, m" line', () => {
    expect(mappedCriteria('## Acceptance criteria -> behaviors\n- A thing. -> behaviors 1, 3\n- Other -> behavior 2\n\n## Out of scope\n')).toEqual([
      { criterion: 'A thing.', behaviours: [1, 3] },
      { criterion: 'Other', behaviours: [2] },
    ]);
  });

  it('reads indented, tight and loosely spaced mapping lines exactly', () => {
    const plan = '## Acceptance criteria -> behaviors\n  - Indented -> behaviors 1\n-Tight->behaviors 2\n- Loose   ->   behaviors   3 ,4\n';
    expect(mappedCriteria(plan)).toEqual([
      { criterion: 'Indented', behaviours: [1] },
      { criterion: 'Tight', behaviours: [2] },
      { criterion: 'Loose', behaviours: [3, 4] },
    ]);
  });

  it('skips lines that are not bullets or that trail off after the numbers', () => {
    const plan = '## Acceptance criteria -> behaviors\nNote - A -> behaviors 1\n- B -> behaviors 2 and more\n';
    expect(mappedCriteria(plan)).toEqual([]);
  });

  it('reads nothing from a plan without the section', () => {
    expect(mappedCriteria('## Behavior list\n- A -> behaviors 1\n')).toEqual([]);
  });
});

describe('namedPaths', () => {
  it('finds backticked repo paths, with or without a line number', () => {
    expect(namedPaths('see `src/a.ts:12` and `src/b.ts`, not `npm test` or `x`')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('finds paths nested more than one directory deep', () => {
    expect(namedPaths('`gates/plan/lint.ts:9`')).toEqual(['gates/plan/lint.ts']);
  });

  it('finds a path with a line range, and a slash path with any extension (#46)', () => {
    expect(namedPaths('`tsconfig.json:4-16` and `src/main.rs:1` and `src/a.ts:1-` and `word-count.md`')).toEqual(['tsconfig.json', 'src/main.rs', 'word-count.md']);
  });

  it.each(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'yaml', 'yml'])('finds a file named without a slash when its extension is .%s (#46)', (ext) => {
    expect(namedPaths(`see \`vitest.config.${ext}\` and \`config.${ext}:3\``)).toEqual([`vitest.config.${ext}`, `config.${ext}`]);
  });

  it('leaves code that only looks like a file name without a slash', () => {
    expect(namedPaths('`Array.from` `text.match` `process.exitCode` `main.rs` `.gitignore` `src/`')).toEqual([]);
  });

  it('keeps .. segments so the gate can refuse them', () => {
    expect(namedPaths('`../outside/a.ts` `src/../../b.ts:2`')).toEqual(['../outside/a.ts', 'src/../../b.ts']);
  });
});

describe('crossArtifact', () => {
  it('passes when criteria, behaviours and files all line up', () => {
    expect(messages(GOOD_PLAN)).toEqual([]);
  });

  it('flags a ticket criterion the plan does not map', () => {
    const ticket = `${GOOD_TICKET}- [ ] When the title has digits, the system shall keep them.\n`;
    expect(messages(GOOD_PLAN, ticket)).toEqual(['criterion not mapped to a behaviour: "When the title has digits, the system shall keep them."']);
  });

  it('flags a mapping to a behaviour that does not exist', () => {
    expect(messages(GOOD_PLAN.replace('-> behaviors 2', '-> behaviors 2, 5'))).toEqual(['criterion maps to behaviour 5, which the plan does not have']);
  });

  it('flags a behaviour no criterion asks for', () => {
    expect(messages(GOOD_PLAN.replace('-> behaviors 2', '-> behaviors 1'))).toEqual(['behaviour 2 is not claimed by any criterion']);
  });

  it('flags a mapped criterion that is not in the ticket, word for word', () => {
    expect(messages(GOOD_PLAN.replace('If the title is empty, then', 'If the title is blank, then'))).toEqual([
      'criterion not mapped to a behaviour: "If the title is empty, then the system shall return an empty string."',
      'mapped criterion is not in the ticket: "If the title is blank, then the system shall return an empty string."',
    ]);
  });

  it('flags a file the plan cites that does not exist, ignoring files it says it will create', () => {
    expect(messages(GOOD_PLAN.replace('`src/is-even.ts:1` shows', '`src/missing.ts:1` shows'))).toEqual([
      'cited file does not exist: src/missing.ts',
    ]);
  });

  it('flags a ticket with no acceptance criteria at all', () => {
    expect(messages(GOOD_PLAN, '# 01 X\n\nStatus: ready-for-agent\n')).toEqual([
      'the ticket has no acceptance criteria',
      'mapped criterion is not in the ticket: "When a title is given, the system shall return it lowercased with runs of other characters replaced by one hyphen."',
      'mapped criterion is not in the ticket: "If the title is empty, then the system shall return an empty string."',
    ]);
  });

  it('treats a plan with no behavior list as having no behaviours', () => {
    expect(messages(GOOD_PLAN.replace('## Behavior list', '## Behaviours'))).toEqual([
      'criterion maps to behaviour 1, which the plan does not have',
      'criterion maps to behaviour 2, which the plan does not have',
    ]);
  });

  it('checks a file named without a slash (#46)', () => {
    expect(messages(GOOD_PLAN.replace('`src/is-even.ts:1` shows', '`package.json:3` and `src/is-even.ts:1` show'))).toEqual(['cited file does not exist: package.json']);
  });

  it.each([
    ['What I verified', '`src/is-even.ts:1` shows', '`src/../../etc/passwd.md` and `src/is-even.ts:1` show'],
    ['Approach', 'New pure function in `src/slugify.ts`.', 'New pure function in `src/slugify.ts` and `../outside/new.ts`.'],
  ])('refuses a path with a .. segment, in any section, even one that exists (#46): %s', (_section, from, to) => {
    const everything = (p: string) => p !== 'src/slugify.ts';
    expect(crossArtifact(GOOD_PLAN.replace(from, to), GOOD_TICKET, everything).map((f) => f.message)).toEqual([`cited path leaves the repo: ${to.match(/`([^`]*\.\.[^`]*)`/)![1]!}`]);
  });

  it('refuses a made-up file under Approach unless its line says it is created or new (#46)', () => {
    const changed = GOOD_PLAN.replace('New pure function in `src/slugify.ts`.', 'New pure function in `src/slugify.ts`.\nChange `src/made-up.ts` to call it.');
    expect(messages(changed)).toEqual(['Approach names a file that does not exist and does not say it is new: src/made-up.ts']);
    for (const line of ['Create `src/made-up.ts`.', 'Creates `src/made-up.ts`.', 'A NEW file, `src/made-up.ts`.']) {
      expect(messages(GOOD_PLAN.replace('New pure function in `src/slugify.ts`.', `New pure function in \`src/slugify.ts\`.\n${line}`))).toEqual([]);
    }
    expect(messages(GOOD_PLAN.replace('New pure function in `src/slugify.ts`.', 'Renew `src/slugify.ts`; recreate it.'))).toEqual([
      'Approach names a file that does not exist and does not say it is new: src/slugify.ts',
    ]);
  });

  it('accepts an existing file under Approach without asking whether it is new', () => {
    expect(messages(GOOD_PLAN.replace('New pure function in `src/slugify.ts`.', 'New pure function in `src/slugify.ts`, beside `src/is-even.ts`.'))).toEqual([]);
  });

  it('still wants a file the plan cites outside Approach to exist, even when Approach creates it', () => {
    expect(messages(GOOD_PLAN.replace('no slug code exists yet.', 'no slug code exists yet; `src/slugify.ts` will hold it.'))).toEqual(['cited file does not exist: src/slugify.ts']);
  });

  it('reads Approach lines one at a time, so a "new" on one line does not cover a file on another', () => {
    const plan = GOOD_PLAN.replace('New pure function in `src/slugify.ts`.', 'New pure function in `src/slugify.ts`.\nThen edit `src/other.ts`.');
    expect(messages(plan)).toEqual(['Approach names a file that does not exist and does not say it is new: src/other.ts']);
  });

  it('flags a section that appears more than once (#46)', () => {
    expect(messages(BROKEN.duplicateSection.plan)).toEqual(['section "## Out of scope" appears more than once']);
    const thrice = GOOD_PLAN.replace('## Risks', '## What this is\nAgain.\n\n## What this is\nAnd again.\n\n## Risks');
    expect(messages(thrice)).toEqual(['section "## What this is" appears more than once']);
  });
});
