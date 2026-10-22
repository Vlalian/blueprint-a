// The mechanical half of skills/no-ai-slop: patterns a script can find without judgement.
// Code blocks and inline code are quoted output and are skipped.

export interface Finding {
  kind: 'banned-word' | 'stock-phrase' | 'em-dash' | 'emoji-heading' | 'binary-contrast';
  line: number;
  match: string;
}

type ProseLine = { line: number; text: string };

const BANNED = [
  'delve', 'foster', 'leverage', 'utilize', 'facilitate', 'empower', 'streamline', 'robust',
  'cutting-edge', 'paradigm shift', 'game changer', 'tapestry', 'realm', 'beacon', 'multifaceted',
  'meticulous', 'intricate', 'paramount', 'transformative', 'elevate', 'embark', 'supercharge',
  'harness', 'ever-evolving',
];

const STOCK = [
  "it's worth noting", "it's important to note", 'at the end of the day', 'at its core',
  "in today's world", 'the reality is', 'the truth is', 'going forward', "let's dive in",
  'here is the thing', "here's the thing", 'let me be clear',
];

const SHORT_TEXT = 300;
const LONG_TEXT_DASH_LIMIT = 2;

/** A literal phrase as regex source, so a word list entry never reads as a pattern. */
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BANNED_RE = new RegExp(`\\b(${BANNED.map(escapeRe).join('|')})\\b`, 'gi');
const STOCK_RE = new RegExp(`(${STOCK.map(escapeRe).join('|')})`, 'gi');
const BINARY_RE = /\b(isn't|is not|not just)\b[^.\n]{1,60}?,\s*(it's|but)\b/gi;
const EMOJI_HEADING_RE = /^#{1,6}\s.*\p{Extended_Pictographic}/u;

function proseLines(text: string): ProseLine[] {
  const out: ProseLine[] = [];
  let inFence = false;
  text.split('\n').forEach((raw, i) => {
    if (raw.trimStart().startsWith('```')) {
      inFence = !inFence;
      return;
    }
    if (!inFence) out.push({ line: i + 1, text: raw.replace(/`[^`]*`/g, '') });
  });
  return out;
}

/** The word, phrase and heading findings on one line, in that order. */
function lineFindings({ line, text }: ProseLine): Finding[] {
  const all = (kind: Finding['kind'], re: RegExp): Finding[] =>
    [...text.matchAll(re)].map((m) => ({ kind, line, match: m[0] }));
  const heading: Finding[] = EMOJI_HEADING_RE.test(text) ? [{ kind: 'emoji-heading', line, match: text.trim() }] : [];
  return [...all('banned-word', BANNED_RE), ...all('stock-phrase', STOCK_RE), ...all('binary-contrast', BINARY_RE), ...heading];
}

/**
 * Em dashes are judged over the whole text: any in a short text, more than two in a long one.
 * The finding points at the line of the first dash.
 */
function emDashFindings(lines: ProseLine[]): Finding[] {
  const proseLength = lines.map((l) => l.text).join('\n').length;
  const limit = proseLength < SHORT_TEXT ? 0 : LONG_TEXT_DASH_LIMIT;
  // One entry per dash, holding the line it sits on.
  const dashLines = lines.flatMap((l) => l.text.split('—').slice(1).map(() => l.line));
  if (dashLines.length <= limit) return [];
  return [{ kind: 'em-dash', line: dashLines[0], match: `${dashLines.length} em dashes (limit ${limit})` }];
}

export function lintProse(text: string): Finding[] {
  const lines = proseLines(text);
  const findings = [...lines.flatMap(lineFindings), ...emDashFindings(lines)];
  return findings.sort((a, b) => a.line - b.line);
}
