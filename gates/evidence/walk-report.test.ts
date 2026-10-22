import { describe, expect, it } from 'vitest';
import { walkReportProblems, type WalkReport } from './walk-report.ts';

const DIR = '.walk/sv-50';
const SHA = 'a'.repeat(40);
const PATCH = 'b'.repeat(40);

const WALK_REPORT: WalkReport = {
  kind: 'ticket',
  ticket: 'sv-50',
  url: 'https://app-git-walk-sv-50-team.vercel.app',
  head: SHA,
  patchId: PATCH,
  startedAt: '2026-10-04T10:00:00.000Z',
  viewport: '1280x800',
  video: `${DIR}/walk.webm`,
  stills: [`${DIR}/01-home.png`, `${DIR}/02-settings.png`, `${DIR}/03-saved.png`],
  items: [
    { id: 'AC1', source: 'criterion', claim: 'The hours hint says 30.', status: 'pass', observed: 'The hint reads "30 hours".', evidence: [{ video: `${DIR}/walk.webm`, at: 4.5 }, { screenshot: `${DIR}/02-settings.png` }] },
    { id: 'QA3', source: 'qa', claim: 'Saving settings keeps them.', status: 'flag', observed: 'Saved, but the toast hides the button.', evidence: [{ video: `${DIR}/walk.webm`, at: 9 }] },
    { id: 'QA4', source: 'qa', claim: 'Sign out works.', status: 'not-run', reason: 'the change set does not touch sign-out' },
  ],
  extras: { console: [], pageErrors: [], network5xx: [], axe: [{ rule: 'color-contrast', impact: 'serious', target: 'button.save' }] },
};

const FILES = [`${DIR}/walk.webm`, `${DIR}/01-home.png`, `${DIR}/02-settings.png`, `${DIR}/03-saved.png`];
const exists = (files: string[] = FILES) => (p: string) => files.includes(p);
const with_ = (over: Partial<WalkReport>) => ({ ...WALK_REPORT, ...over });
const item = (i: number, over: object) => WALK_REPORT.items.map((x, j) => (j === i ? { ...x, ...over } : x));

describe('walkReportProblems: the stricter walk report', () => {
  it('accepts a report whose every item cites evidence that exists', () => {
    expect(walkReportProblems(WALK_REPORT, exists())).toEqual([]);
  });

  it.each([null, 'report', ['items']])('refuses %j, which is not a JSON object', (value) => {
    expect(walkReportProblems(value, exists())).toEqual(['the walk report is not a JSON object']);
  });

  it('names every missing field, and every field the schema does not have', () => {
    expect(walkReportProblems({ by: 'me' }, exists())).toEqual([
      'kind must be ticket or staging',
      'ticket must name the ticket (or staging)',
      'url must be the http(s) URL walked',
      'head must be the 40-hex commit walked',
      'patchId must be the 40-hex git patch-id of the change walked',
      'startedAt must be an ISO date and time',
      'viewport must be 1280x800',
      'video must be the repo-relative path of the context video (.webm, .mp4)',
      'stills must list 3 to 6 checkpoint screenshots (.png, .jpg, .jpeg, .webp)',
      'items must list at least one item',
      'extras must have console, pageErrors, network5xx and axe lists',
      'unknown field "by"',
    ]);
  });

  it.each([
    [{ kind: 'prod' }, 'kind must be ticket or staging'],
    [{ ticket: ' ' }, 'ticket must name the ticket (or staging)'],
    [{ url: 'ftp://x' }, 'url must be the http(s) URL walked'],
    [{ url: 'https://' }, 'url must be the http(s) URL walked'],
    [{ url: 'see https://app.vercel.app' }, 'url must be the http(s) URL walked'],
    [{ head: 'a'.repeat(39) }, 'head must be the 40-hex commit walked'],
    [{ head: `${'a'.repeat(40)}0` }, 'head must be the 40-hex commit walked'],
    [{ head: 'A'.repeat(40) }, 'head must be the 40-hex commit walked'],
    [{ patchId: `x${'b'.repeat(40)}` }, 'patchId must be the 40-hex git patch-id of the change walked'],
    [{ startedAt: '2026-10-04' }, 'startedAt must be an ISO date and time'],
    [{ startedAt: '+002026-10-04T10:00:00Z' }, 'startedAt must be an ISO date and time'],
    [{ startedAt: '2026-13-40T10:00' }, 'startedAt must be an ISO date and time'],
    [{ viewport: '390x844' }, 'viewport must be 1280x800'],
    [{ video: `${DIR}/walk.png` }, 'video must be the repo-relative path of the context video (.webm, .mp4)'],
    [{ video: `${DIR}/walk.webm.txt` }, 'video must be the repo-relative path of the context video (.webm, .mp4)'],
    [{ video: `../walk.webm` }, 'video must be the repo-relative path of the context video (.webm, .mp4)'],
    [{ stills: WALK_REPORT.stills.slice(0, 2) }, 'stills must list 3 to 6 checkpoint screenshots (.png, .jpg, .jpeg, .webp)'],
    [{ stills: [...WALK_REPORT.stills, ...WALK_REPORT.stills, 'x.png'] }, 'stills must list 3 to 6 checkpoint screenshots (.png, .jpg, .jpeg, .webp)'],
    [{ stills: [...WALK_REPORT.stills.slice(0, 2), `${DIR}/walk.webm`] }, 'stills must list 3 to 6 checkpoint screenshots (.png, .jpg, .jpeg, .webp)'],
    [{ stills: 'a.png' }, 'stills must list 3 to 6 checkpoint screenshots (.png, .jpg, .jpeg, .webp)'],
    [{ items: [] }, 'items must list at least one item'],
    [{ extras: { console: [], pageErrors: [], network5xx: [] } }, 'extras must have console, pageErrors, network5xx and axe lists'],
    [{ extras: { console: [], pageErrors: [], network5xx: [], axe: {} } }, 'extras must have console, pageErrors, network5xx and axe lists'],
    [{ extras: [] }, 'extras must have console, pageErrors, network5xx and axe lists'],
  ])('refuses %j', (over, problem) => {
    expect(walkReportProblems(with_(over as Partial<WalkReport>), exists())).toEqual([problem]);
  });

  it('accepts a staging walk over http, a citation at 0 s and a 500', () => {
    const items = item(0, { evidence: [{ video: `${DIR}/walk.webm`, at: 0 }] });
    const extras = { ...WALK_REPORT.extras, network5xx: [{ url: '/api', status: 500 }] };
    expect(walkReportProblems(with_({ kind: 'staging', ticket: 'staging', url: 'http://127.0.0.1:4173/', items, extras }), exists())).toEqual([]);
  });

  it('refuses a field the schema does not have on an otherwise good report', () => {
    expect(walkReportProblems({ ...WALK_REPORT, by: 'me' }, exists())).toEqual(['unknown field "by"']);
  });

  it('accepts six stills', () => {
    const six = [...WALK_REPORT.stills, `${DIR}/04.png`, `${DIR}/05.png`, `${DIR}/06.png`];
    expect(walkReportProblems(with_({ stills: six }), exists([...FILES, ...six]))).toEqual([]);
  });

  it('refuses an item without evidence, whatever its status, but a not-run one with a reason', () => {
    for (const status of ['pass', 'fail', 'flag']) {
      expect(walkReportProblems(with_({ items: item(0, { status, evidence: [] }) }), exists())).toEqual([`item AC1 (${status}) cites no video timestamp or screenshot`]);
    }
    expect(walkReportProblems(with_({ items: item(0, { evidence: undefined }) }), exists())).toEqual(['item AC1 (pass) cites no video timestamp or screenshot']);
  });

  it('refuses a not-run item without a reason', () => {
    expect(walkReportProblems(with_({ items: item(2, { reason: '' }) }), exists())).toEqual(['item QA4 is not-run without a reason']);
  });

  it('refuses items whose shape is wrong', () => {
    expect(walkReportProblems(with_({ items: [{ id: '', source: 'web', claim: '', status: 'ok' } as never] }), exists())).toEqual([
      'item 1 needs an id',
      'item 1 source must be criterion or qa',
      'item 1 needs its claim',
      'item 1 status must be pass, fail, flag or not-run',
    ]);
    expect(walkReportProblems(with_({ items: [7 as never] }), exists())).toEqual(['item 1 is not an object']);
    expect(walkReportProblems(with_({ items: item(1, { id: 'AC1' }) }), exists())).toEqual(['item id AC1 is used twice']);
    expect(walkReportProblems(with_({ items: item(0, { observed: ' ' }) }), exists())).toEqual(['item AC1 must say what was observed']);
    expect(walkReportProblems(with_({ items: item(0, { note: 'x' }) }), exists())).toEqual(['item AC1 has an unknown field "note"']);
  });

  it('refuses a citation that is neither a screenshot nor a video timestamp of the walk video', () => {
    const bad = [{ screenshot: `${DIR}/a.webm` }, { video: `${DIR}/other.webm`, at: 1 }, { video: `${DIR}/walk.webm`, at: -1 }, { video: `${DIR}/walk.webm`, at: '3' }, { video: `${DIR}/walk.webm` }, 'x.png', { screenshot: '/abs.png' }];
    expect(walkReportProblems(with_({ items: item(0, { evidence: bad }) }), exists())).toEqual(
      bad.map((_, i) => `item AC1 citation ${i + 1} is not { "screenshot": <image path> } or { "video": "${DIR}/walk.webm", "at": <seconds> }`),
    );
  });

  it('refuses media files that were never saved', () => {
    expect(walkReportProblems(WALK_REPORT, exists([]))).toEqual([
      `the media file ${DIR}/walk.webm does not exist`,
      `the media file ${DIR}/01-home.png does not exist`,
      `the media file ${DIR}/02-settings.png does not exist`,
      `the media file ${DIR}/03-saved.png does not exist`,
    ]);
    expect(walkReportProblems(with_({ items: item(0, { evidence: [{ screenshot: `${DIR}/zz.png` }] }) }), exists())).toEqual([`the media file ${DIR}/zz.png does not exist`]);
  });

  it('refuses video timestamps that go back', () => {
    expect(walkReportProblems(with_({ items: item(1, { evidence: [{ video: `${DIR}/walk.webm`, at: 4 }] }) }), exists())).toEqual([
      'video timestamps must ascend: item QA3 cites 4 s after 4.5 s',
    ]);
    expect(walkReportProblems(with_({ items: item(1, { evidence: [{ video: `${DIR}/walk.webm`, at: 4.5 }] }) }), exists())).toEqual([]);
  });

  it('refuses a report that shows an email address', () => {
    // Built from parts, so this file holds no address for the export's package check to find.
    const plain = ['someone', 'example.com'].join('@');
    const tagged = ['a.b+c', 'mail.example.co.uk'].join('@');
    expect(walkReportProblems(with_({ items: item(0, { observed: `Signed in as ${plain}.` }) }), exists())).toEqual([
      `the report shows an email address (blur them): ${plain}`,
    ]);
    expect(walkReportProblems(with_({ items: item(0, { observed: `Sent to ${tagged}` }) }), exists())).toEqual([
      `the report shows an email address (blur them): ${tagged}`,
    ]);
  });

  it('refuses extras entries of the wrong shape', () => {
    const extras = { console: ['x'], pageErrors: [{ text: '' }], network5xx: [{ url: 'u', status: 404 }], axe: [{ rule: 'r' }] };
    expect(walkReportProblems(with_({ extras } as never), exists())).toEqual([
      'extras.console 1 is not { "text": <message> }',
      'extras.pageErrors 1 is not { "text": <message> }',
      'extras.network5xx 1 is not { "url": <url>, "status": 500-599 }',
      'extras.axe 1 is not { "rule": <axe rule>, "impact": <impact>, "target": <selector> }',
    ]);
    const good = { console: [{ text: 'boom' }], pageErrors: [{ text: 'TypeError' }], network5xx: [{ url: 'u', status: 599 }], axe: [] };
    expect(walkReportProblems(with_({ extras: good }), exists())).toEqual([]);
    expect(walkReportProblems(with_({ extras: { ...good, network5xx: [{ url: 'u', status: 600 }] } }), exists())).toHaveLength(1);
    expect(walkReportProblems(with_({ extras: { ...good, network5xx: [{ url: '', status: 500 }] } }), exists())).toHaveLength(1);
    for (const gone of ['rule', 'impact', 'target']) {
      const axe = [{ rule: 'r', impact: 'minor', target: 't', [gone]: '' }];
      expect(walkReportProblems(with_({ extras: { ...good, axe } }), exists())).toHaveLength(1);
    }
  });
});
