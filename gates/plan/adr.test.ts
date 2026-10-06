import { describe, expect, it } from 'vitest';
import { adrFindings, adrFlags } from './adr.ts';
import { crossArtifact } from './cross-artifact.ts';
import { GOOD_PLAN, GOOD_TICKET } from './fixtures.ts';

// Ticket 50 (Matt's domain.md): a plan never overrides a decision record silently. An Approach line
// that goes against an ADR carries the flag "Contradicts ADR-NNNN, worth reopening because ...".
const APPROACH = 'New pure function in `src/slugify.ts`.';
const withApproach = (line: string) => GOOD_PLAN.replace(APPROACH, `${APPROACH}\n${line}`);
const FLAG = 'Contradicts ADR-0005, worth reopening because one controller per project cannot keep up with the pilot.';
const messages = (plan: string) => crossArtifact(plan, GOOD_TICKET, (p) => ['src/is-even.ts', 'docs/adr/0005-topology.md'].includes(p)).map((f) => f.message);

describe('adrFindings', () => {
  it('passes a plan that names no ADR, or follows one', () => {
    expect(adrFindings(GOOD_PLAN)).toEqual([]);
    expect(adrFindings(withApproach('One controller per project, as ADR-0005 says.'))).toEqual([]);
  });

  it.each([
    'Run one process per role, which contradicts ADR-0005.',
    'We contradict ADR-0005 here.',
    'Overrides ADR-0005: a long-lived swarm.',
    'This reverses ADR-0005.',
    'Overturn ADR-0005 for speed.',
    'Go against ADR-0005 here.',
    'Despite ADR-0005, keep the swarm.',
    'A swarm instead of the topology in ADR-0005.',
    'Ignore ADR-0005 for this ticket.',
    'Depart from ADR-0005.',
    'Drop the cap from ADR-0005.',
    'Replace the dispatcher of `docs/adr/0005-topology.md` with a swarm.',
    'Contradicts ADR-0005.',
  ])('refuses an Approach that contradicts an ADR without the flag: %s', (line) => {
    expect(messages(withApproach(line))).toEqual(['Approach contradicts ADR-0005 without the flag "Contradicts ADR-0005, worth reopening because ..."']);
  });

  it('passes a contradiction that carries the flag, in the Approach or anywhere else in the plan', () => {
    expect(messages(withApproach(`Run one process per role, against ADR-0005. ${FLAG}`))).toEqual([]);
    const flagged = withApproach('Run one process per role, against ADR-0005.').replace("## Needs the owner's own eyes\nNone.", `## Needs the owner's own eyes\n- ${FLAG}`);
    expect(messages(flagged)).toEqual([]);
  });

  it('wants the flag for the ADR it contradicts, with a reason', () => {
    expect(adrFindings(withApproach(`Against ADR-0005. ${FLAG.replace('0005', '0004')}`)).map((f) => f.message)).toEqual([
      'Approach contradicts ADR-0005 without the flag "Contradicts ADR-0005, worth reopening because ..."',
    ]);
    expect(adrFindings(withApproach('Against ADR-0005. Contradicts ADR-0005, worth reopening because')).length).toBe(1);
  });

  it('names each contradicted ADR once, and only ADRs under Approach', () => {
    const plan = withApproach('Against ADR-0005 and ADR-0003.\nAlso against ADR-0005.').replace('Titles need URL slugs.', 'Titles need URL slugs, against ADR-0001.');
    expect(adrFindings(plan).map((f) => f.message)).toEqual([
      'Approach contradicts ADR-0005 without the flag "Contradicts ADR-0005, worth reopening because ..."',
      'Approach contradicts ADR-0003 without the flag "Contradicts ADR-0003, worth reopening because ..."',
    ]);
  });

  it('does not read words that only contain a contradiction verb, or an ADR number of another length', () => {
    expect(adrFindings(withApproach('The dropdown follows ADR-0005; reversal-free.\nIgnore ADR-05 and docs/adr/05-x.md.'))).toEqual([]);
  });
});

describe('adrFlags', () => {
  it('lists the ADRs the plan flags as worth reopening, once each', () => {
    expect(adrFlags(withApproach(`${FLAG} ${FLAG.replace('0005', '0007')} ${FLAG}`))).toEqual(['ADR-0005', 'ADR-0007']);
    expect(adrFlags(GOOD_PLAN)).toEqual([]);
  });
});
