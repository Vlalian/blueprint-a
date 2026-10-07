// Secret scan over added lines (patterns from ECC's pre-commit hook, plus decision 43: Stripe,
// Slack, Google, JWT and unquoted `.env` assignments). Reports file, line and
// kind with a shortened excerpt; it never prints a full secret back into a log or briefing.

import type { AddedLine } from '../lib/diff.ts';

export interface SecretFinding {
  file: string;
  line: number;
  kind: string;
  excerpt: string;
}

const PATTERNS: Array<[kind: string, re: RegExp]> = [
  ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['stripe-key', /\b[sr]k_live_[A-Za-z0-9]{24,}/],
  ['slack-token', /\bxox[abpors]-[A-Za-z0-9-]{10,}/],
  ['google-api-key', /(?<![\w-])AIza[\w-]{35}(?![\w-])/],
  ['jwt', /\beyJ[\w-]{7,}\.eyJ[\w-]{7,}\.[\w-]{10,}/],
  ['credential-assignment', /\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i],
];

const PLACEHOLDER = /^(?:\*+|<.*>|\$\{.*\}|.*(?:example|placeholder|changeme|your[-_]|dummy|fake|redacted|xxx).*)$/i;

// An unquoted `KEY=value` line of a `.env*` file (ECC's heuristic): reported only when the value
// holds a digit and is 12 or more characters, so `DEBUG=true` and `PORT=3000` stay quiet.
const ENV_FILE = /(?:^|[\\/])\.env[^\\/]*$/;
const ENV_ASSIGNMENT = /^\s*(?:export\s+)?[A-Za-z_]\w*\s*=\s*([^\s"'#]\S*)/;
const looksSecret = (value: string) => /\d/.test(value) && value.length >= 12 && !PLACEHOLDER.test(value);

const shorten = (s: string) => `${s.slice(0, 6)}…`;

const isPlaceholder = (kind: string, value: string) => kind === 'credential-assignment' && PLACEHOLDER.test(value);

// The first kind of secret a line holds, skipping placeholder credentials.
function findSecret(text: string): { kind: string; value: string } | undefined {
  for (const [kind, re] of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const value = m[1] ?? m[0];
    if (!isPlaceholder(kind, value)) return { kind, value };
  }
  return undefined;
}

function envSecret(file: string, text: string): { kind: string; value: string } | undefined {
  const m = ENV_FILE.test(file) ? ENV_ASSIGNMENT.exec(text) : null;
  return m && looksSecret(m[1]) ? { kind: 'env-assignment', value: m[1] } : undefined;
}

export function scanSecrets(lines: AddedLine[]): SecretFinding[] {
  return lines.flatMap(({ file, line, text }) => {
    const found = findSecret(text) ?? envSecret(file, text);
    return found ? [{ file, line, kind: found.kind, excerpt: shorten(found.value) }] : [];
  });
}
