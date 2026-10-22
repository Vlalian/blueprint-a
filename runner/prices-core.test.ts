import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrices, priceUsd, rateFor, type PriceTable } from './prices-core.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SHIPPED = readFileSync(join(ROOT, 'config', 'prices.json'), 'utf8');

const RATES = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const table = (models: Record<string, unknown> = { sonnet: RATES }, over: Record<string, unknown> = {}) =>
  JSON.stringify({ date: '2026-10-04', source: 'a page', placeholder: false, models, ...over });
const ok = (text: string) => {
  const r = parsePrices(text);
  if (!r.ok) throw new Error(r.error);
  return r.table;
};

describe('the price table is read from config, never hard-coded', () => {
  it('reads the shipped config/prices.json: dated, with a source, marked placeholder until real rates are cited', () => {
    const t = ok(SHIPPED);
    expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t.source).toMatch(/PLACEHOLDER/);
    expect(t.placeholder).toBe(true);
    expect(Object.keys(t.models).sort()).toEqual(['fable', 'haiku', 'opus', 'sonnet']);
  });

  it('prices with whatever table it is given: two tables give two prices for the same usage', () => {
    const usage = { tokensIn: 1_000_000, tokensOut: 2_000_000, cacheRead: 3_000_000, cacheWrite: 4_000_000 };
    expect(priceUsd(rateFor(ok(table()), 'claude-sonnet-4-5')!, usage)).toBeCloseTo(3 + 30 + 0.9 + 15, 10);
    const doubled = { input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 };
    expect(priceUsd(rateFor(ok(table({ sonnet: doubled })), 'claude-sonnet-4-5')!, usage)).toBeCloseTo(2 * (3 + 30 + 0.9 + 15), 10);
  });

  it('prices each token kind at its own rate', () => {
    const r = { input: 1, output: 10, cacheRead: 100, cacheWrite: 1000 };
    expect(priceUsd(r, { tokensIn: 1_000_000, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })).toBe(1);
    expect(priceUsd(r, { tokensIn: 0, tokensOut: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(10);
    expect(priceUsd(r, { tokensIn: 0, tokensOut: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBe(100);
    expect(priceUsd(r, { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 1_000_000 })).toBe(1000);
  });

  it('finds a model by the longest family name it contains, in any case; an unknown model has no rate', () => {
    const t = ok(table({ sonnet: RATES, 'sonnet-5': { ...RATES, input: 9 }, haiku: { ...RATES, input: 1 } }));
    expect(rateFor(t, 'claude-SONNET-5-5')?.input).toBe(9);
    expect(rateFor(t, 'claude-sonnet-4-5')?.input).toBe(3);
    expect(rateFor(t, 'Haiku')?.input).toBe(1);
    expect(rateFor(t, 'gpt-5-codex')).toBeUndefined();
  });

  it.each<[string, string, string]>([
    ['not json', '{', 'config/prices.json is not valid JSON'],
    ['not an object', 'null', 'config/prices.json is not a JSON object'],
    ['a plain value', '3', 'config/prices.json is not a JSON object'],
    ['no date', table(undefined, { date: undefined }), 'config/prices.json: date must be YYYY-MM-DD'],
    ['a date in words', table(undefined, { date: '4 Oct' }), 'config/prices.json: date must be YYYY-MM-DD'],
    ['text before the date', table(undefined, { date: 'x2026-10-04' }), 'config/prices.json: date must be YYYY-MM-DD'],
    ['text after the date', table(undefined, { date: '2026-10-04x' }), 'config/prices.json: date must be YYYY-MM-DD'],
    ['a source as a number', table(undefined, { source: 5 }), 'config/prices.json: source must name where the rates come from'],
    ['no source', table(undefined, { source: ' ' }), 'config/prices.json: source must name where the rates come from'],
    ['placeholder not a flag', table(undefined, { placeholder: 'no' }), 'config/prices.json: placeholder must be true or false'],
    ['no models', table({}), 'config/prices.json: models must name at least one model family'],
    ['models a list', table(undefined, { models: [RATES] }), 'config/prices.json: models must name at least one model family'],
    ['a rate missing', table({ sonnet: { ...RATES, cacheWrite: undefined } }), 'config/prices.json: sonnet.cacheWrite must be a number of 0 or more'],
    ['a negative rate', table({ sonnet: { ...RATES, input: -1 } }), 'config/prices.json: sonnet.input must be a number of 0 or more'],
    ['a rate as text', table({ sonnet: { ...RATES, output: '15' } }), 'config/prices.json: sonnet.output must be a number of 0 or more'],
    ['a family not an object', table({ sonnet: 3 }), 'config/prices.json: sonnet.input must be a number of 0 or more'],
  ])('refuses a broken table (%s), never a default', (_name, text, error) => {
    expect(parsePrices(text)).toEqual({ ok: false, error });
  });

  it('keeps the date, source, flag and every family as read', () => {
    expect(ok(table({ sonnet: RATES, opus: { ...RATES, input: 0 } }))).toEqual<PriceTable>({
      date: '2026-10-04',
      source: 'a page',
      placeholder: false,
      models: { sonnet: RATES, opus: { ...RATES, input: 0 } },
    });
  });
});
