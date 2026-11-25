// Enough XML for the test and coverage reports the gates read: coverlet's Cobertura (adapters/dotnet)
// and pytest's JUnit XML (the red check and the skipped-tests guard, ticket 99). Elements, their
// attributes and text; the prolog and comments are skipped. Pure.

export interface Element {
  name: string;
  attrs: Record<string, string>;
  children: Element[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const ENTITY = /&(?:(lt|gt|quot|apos|amp)|#(\d+)|#x([0-9a-fA-F]+));/g;
export const decode = (text: string) =>
  text.replace(ENTITY, (_, named: string | undefined, dec: string | undefined, hex: string | undefined) =>
    named !== undefined ? ENTITIES[named]! : String.fromCodePoint(dec !== undefined ? Number(dec) : parseInt(hex!, 16)),
  );
const TAG = /<(\/?)([\w-]+)([^>]*?)(\/?)>/g;
const ATTR = /([\w-]+)="([^"]*)"/g;

/** A nameless root holding the document's elements. */
export function parseXml(xml: string): Element {
  const root: Element = { name: '', attrs: {}, children: [], text: '' };
  const open = [root];
  let last = 0;
  for (const m of xml.matchAll(TAG)) {
    open.at(-1)!.text += xml.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] === '/') {
      open.pop();
      continue;
    }
    const element = { name: m[2]!, attrs: Object.fromEntries([...m[3]!.matchAll(ATTR)].map(([, k, v]) => [k, decode(v!)])), children: [], text: '' };
    open.at(-1)!.children.push(element);
    if (m[4] !== '/') open.push(element);
  }
  return root;
}

/** The elements reached from `from` by following child names in order. */
export const under = (from: Element[], names: string[]) => names.reduce((level, name) => level.flatMap((e) => e.children.filter((c) => c.name === name)), from);

/** Every element called `name` at any depth below `from`. */
export const descendants = (from: Element, name: string): Element[] => from.children.flatMap((c) => [...(c.name === name ? [c] : []), ...descendants(c, name)]);
