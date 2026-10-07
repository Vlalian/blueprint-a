import { describe, expect, it } from 'vitest';
import { earsFindings, isEars, VAGUE_WORDS, vagueWord } from './ears.ts';

describe('isEars', () => {
  it.each([
    'The system shall log every refused handoff.',
    'When a title is given, the system shall return a slug.',
    'While the run is paused, the dispatcher shall start no controller.',
    'If the title is empty, then the system shall return an empty string.',
    'Where incremental mode is on, onkel shall re-test only changed mutants.',
    'when a title is given, the system shall return a slug.',
    '  The system shall ignore surrounding whitespace.  ',
  ])('accepts the EARS form: %s', (criterion) => {
    expect(isEars(criterion)).toBe(true);
  });

  it.each([
    'Slugs should look nice.',
    'Handle empty titles.',
    'When a title is given the system returns a slug.',
    'If the title is empty, the system shall return an empty string.',
    'The system shall.',
    'When a title is given, return a slug.',
  ])('refuses a vague or malformed criterion: %s', (criterion) => {
    expect(isEars(criterion)).toBe(false);
  });
});

describe('earsFindings', () => {
  it('names each criterion that is not in EARS form', () => {
    expect(earsFindings(['The system shall log it.', 'Make it fast.'])).toEqual([
      { message: 'criterion is not in EARS form ("When <trigger>, the <system> shall <response>"): "Make it fast."' },
    ]);
  });
});

describe('vague words (#38)', () => {
  it.each([
    ['correctly', 'When a title is given, the system shall slug it correctly.'],
    ['properly', 'The system shall properly escape titles.'],
    ['appropriate', 'If the title is empty, then the system shall show an appropriate error.'],
    ['appropriately', 'While offline, the system shall queue requests appropriately.'],
    ['as appropriate', 'Where logging is on, the system shall log as appropriate.'],
    ['fast', 'The system shall be fast.'],
    ['quickly', 'When asked, the system shall answer quickly.'],
    ['efficient', 'The system shall use an efficient search.'],
    ['efficiently', 'The system shall store slugs efficiently.'],
    ['user-friendly', 'The system shall print a user-friendly message.'],
    ['robust', 'The system shall be robust to bad input.'],
    ['as needed', 'When a lock is stale, the system shall retry as needed.'],
    ['reasonable', 'The system shall answer in a reasonable time.'],
    ['reasonably', 'The system shall answer reasonably soon.'],
    ['adequate', 'The system shall keep adequate logs.'],
    ['adequately', 'The system shall test adequately.'],
    ['intuitive', 'The system shall have an intuitive layout.'],
    ['seamless', 'The system shall give a seamless upgrade.'],
    ['seamlessly', 'The system shall upgrade seamlessly.'],
    ['gracefully', 'If the disk is full, then the system shall fail gracefully.'],
    ['easy', 'The system shall be easy to read.'],
    ['easily', 'The system shall be easily extended.'],
    ['flexible', 'The system shall offer a flexible format.'],
    ['optimal', 'The system shall pick the optimal route.'],
    ['optimally', 'The system shall pack optimally.'],
    ['sufficient', 'The system shall keep sufficient history.'],
    ['sufficiently', 'The system shall be sufficiently quick.'],
    ['if possible', 'When a title is given, the system shall keep digits if possible.'],
    ['as soon as possible', 'When a run fails, the system shall alert as soon as possible.'],
    ['etc', 'The system shall strip commas, dots, etc.'],
    ['and/or', 'The system shall log and/or print it.'],
  ])('names the vague word %s', (word, criterion) => {
    expect(vagueWord(criterion)).toBe(word);
    expect(earsFindings([criterion])).toEqual([{ message: `criterion uses the vague word "${word}"; name what is measured or checked instead: "${criterion}"` }]);
  });

  it('keeps the list as data, every word on it caught in any case', () => {
    expect(VAGUE_WORDS.length).toBeGreaterThanOrEqual(31);
    for (const word of VAGUE_WORDS) expect(vagueWord(`The system shall be ${word.toUpperCase()} here.`)).toBe(word);
  });

  it.each([
    'When a title is given, the system shall return it lowercased with runs of other characters replaced by one hyphen.',
    'If the title is empty, then the system shall return an empty string.',
    'When a branch can fast-forward, the system shall merge it.',
    'The system shall serve breakfast menus.',
    'The system shall report robustness scores.',
    'The system shall read the steady-easy flag.',
    'The system shall count fastest runs.',
  ])('passes a precise criterion that only contains a vague word inside another: %s', (criterion) => {
    expect(vagueWord(criterion)).toBeUndefined();
    expect(earsFindings([criterion])).toEqual([]);
  });

  it('reports only the form when a criterion is neither EARS nor precise', () => {
    expect(earsFindings(['Make it fast.']).map((f) => f.message)).toEqual(['criterion is not in EARS form ("When <trigger>, the <system> shall <response>"): "Make it fast."']);
  });
});
