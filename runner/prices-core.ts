// The model price table (ticket 15c): config/prices.json, USD per million tokens per model family,
// dated and with its source. Read at every evaluation and parsed fail-closed: a broken table is an
// error, never a default rate. A session's model is priced by the longest family name it contains
// (`claude-sonnet-4-5` by `sonnet`); a model no family names has no price.

export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface PriceTable {
  /** The day the rates were read, YYYY-MM-DD. */
  date: string;
  /** Where the rates come from. */
  source: string;
  /** True while the rates are placeholders, not cited prices: every USD figure is marked so. */
  placeholder: boolean;
  models: Record<string, Rates>;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

const RATE_KEYS: (keyof Rates)[] = ['input', 'output', 'cacheRead', 'cacheWrite'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (problem: string): never => {
  throw new Error(`config/prices.json${problem}`);
};

function objectOf(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail(' is not valid JSON');
  }
  if (typeof value !== 'object' || value === null) fail(' is not a JSON object');
  return value as Record<string, unknown>;
}

function ratesOf(family: string, raw: unknown): Rates {
  const r = Object(raw) as Record<string, unknown>;
  for (const key of RATE_KEYS) {
    const n = r[key];
    if (typeof n !== 'number' || !(n >= 0)) fail(`: ${family}.${key} must be a number of 0 or more`);
  }
  return { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite } as Rates;
}

type Check = [(t: Record<string, unknown>) => boolean, string];

const CHECKS: Check[] = [
  [(t) => DATE.test(String(t.date)), ': date must be YYYY-MM-DD'],
  [(t) => typeof t.source === 'string' && t.source.trim() !== '', ': source must name where the rates come from'],
  [(t) => typeof t.placeholder === 'boolean', ': placeholder must be true or false'],
  [(t) => !Array.isArray(t.models) && Object.keys(Object(t.models)).length > 0, ': models must name at least one model family'],
];

function read(text: string): PriceTable {
  const t = objectOf(text);
  const failed = CHECKS.find(([holds]) => !holds(t));
  if (failed !== undefined) fail(failed[1]);
  const rates = Object.fromEntries(Object.entries(t.models as object).map(([family, raw]) => [family, ratesOf(family, raw)]));
  return { date: t.date as string, source: t.source as string, placeholder: t.placeholder as boolean, models: rates };
}

export function parsePrices(text: string): { ok: true; table: PriceTable } | { ok: false; error: string } {
  try {
    return { ok: true, table: read(text) };
  } catch (e) {
    // Only fail() throws in read().
    return { ok: false, error: (e as Error).message };
  }
}

/** The rates of the longest family name the model contains, in any case; undefined when none does. */
export function rateFor(table: PriceTable, model: string): Rates | undefined {
  const name = model.toLowerCase();
  const families = Object.keys(table.models).filter((f) => name.includes(f.toLowerCase()));
  return families.sort((a, b) => b.length - a.length).map((f) => table.models[f])[0];
}

/** USD for one session's tokens at these rates. */
export function priceUsd(r: Rates, u: Usage): number {
  return (u.tokensIn * r.input + u.tokensOut * r.output + u.cacheRead * r.cacheRead + u.cacheWrite * r.cacheWrite) / 1_000_000;
}
