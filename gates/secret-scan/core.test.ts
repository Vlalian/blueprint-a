import { describe, expect, it } from 'vitest';
import { scanSecrets } from './core.ts';

// Built at runtime so no secret-shaped literal sits in this file.
const fake = {
  anthropic: ['sk', 'ant', 'api03', 'a'.repeat(40)].join('-'),
  openai: 'sk-' + 'b'.repeat(40),
  github: 'ghp_' + 'c'.repeat(36),
  githubPat: 'github_pat_' + 'd'.repeat(40),
  aws: 'AKIA' + 'E'.repeat(16),
  pem: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  // A credential-shaped value, split so an assignment of it never sits in this file as a literal.
  value: 'q8Zr2L' + 'mP0vXy7Tn4',
};
const line = (text: string) => ({ file: 'src/a.ts', line: 1, text });
const kinds = (texts: string[]) => scanSecrets(texts.map(line)).map((f) => f.kind);

describe('scanSecrets', () => {
  it('finds provider keys, tokens and private keys', () => {
    expect(kinds([fake.anthropic, fake.openai, fake.github, fake.githubPat, fake.aws, fake.pem])).toEqual([
      'anthropic-key', 'openai-key', 'github-token', 'github-token', 'aws-access-key', 'private-key',
    ]);
  });

  it('finds a hard-coded credential assignment', () => {
    expect(kinds([`const apiKey = '${fake.value}';`, 'PASSWORD="hunter2' + 'hunter2"'])).toEqual(['credential-assignment', 'credential-assignment']);
  });

  it('ignores placeholders and values read from the environment', () => {
    expect(kinds([
      "const apiKey = process.env.API_KEY;",
      "token: '<your-token-here>'",
      "password = 'example-password'",
      "secret: '${SECRET}'",
      "apiKey: 'xxxxxxxxxxxx'",
    ])).toEqual([]);
  });

  it('needs the full length of a provider key before it reports one', () => {
    expect(kinds([
      ['sk', 'ant', 'a'.repeat(19)].join('-'),
      'sk-' + 'b'.repeat(19),
      'ghp_' + 'c'.repeat(35),
      'github_pat_' + 'd'.repeat(19),
    ])).toEqual([]);
  });

  it('finds an untyped private key header', () => {
    expect(kinds(['-----BEGIN ' + 'PRIVATE KEY-----'])).toEqual(['private-key']);
  });

  it('finds credential assignments in every key spelling, including quoted JSON keys', () => {
    const v = 'q8Zr2LmP0vXy7Tn4';
    expect(kinds([`api_key = '${v}'`, `api-key: "${v}"`, `passwd = '${v}'`, `"token": "${v}"`])).toEqual([
      'credential-assignment', 'credential-assignment', 'credential-assignment', 'credential-assignment',
    ]);
  });

  it('reads a placeholder only as a whole value', () => {
    const token = (v: string) => `token = '${v}'`;
    expect(kinds([token(`${fake.value.slice(0, -1)}x`), token(`x${fake.value.slice(0, -1)}`), token('q8Zr2Lm<P0>'), token('<P0>q8Zr2Lm')])).toEqual(Array(4).fill('credential-assignment'));
    expect(kinds([`token = '********'`, `token = '<TOKEN_VALUE>'`, `token = 'your_token_here'`])).toEqual([]);
  });

  it('never treats a provider key as a placeholder, even one with a placeholder word in it', () => {
    expect(kinds(['sk-' + 'example' + 'b'.repeat(20)])).toEqual(['openai-key']);
  });

  it('reports where it found each one but never echoes the full secret', () => {
    const [f] = scanSecrets([{ file: 'src/a.ts', line: 7, text: `const k = '${fake.github}';` }]);
    expect(f).toMatchObject({ file: 'src/a.ts', line: 7, kind: 'github-token' });
    expect(f!.excerpt).not.toContain(fake.github);
    expect(f!.excerpt).toMatch(/^ghp_c{2}…$/);
  });

  it('reports one finding per line, in line order', () => {
    const lines = [
      { file: 'a', line: 1, text: `${fake.github} ${fake.aws}` },
      { file: 'a', line: 2, text: 'nothing here' },
      { file: 'b', line: 3, text: `const apiKey = '${fake.value}';` },
    ];
    expect(scanSecrets(lines)).toEqual([
      { file: 'a', line: 1, kind: 'github-token', excerpt: 'ghp_cc…' },
      { file: 'b', line: 3, kind: 'credential-assignment', excerpt: 'q8Zr2L…' },
    ]);
  });
});

// Built at runtime from pieces, like `fake` above, so no secret shape sits in this file.
const more = {
  stripe: ['sk', 'live', 'Ab3'.repeat(8)].join('_'),
  stripeRestricted: ['rk', 'live', 'Ab3'.repeat(8)].join('_'),
  slack: ['xox' + 'b', '1234567890', 'abcdefABCDEF'].join('-'),
  google: 'AI' + 'za' + 'Sy' + 'A1b2C3d4E5'.repeat(3) + 'xyz',
  jwt: ['ey' + 'JhbGciOiJIUzI1NiJ9', 'ey' + 'JzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.'),
  gho: 'gh' + 'o_' + 'f'.repeat(36),
  ghs: 'gh' + 's_' + 'g'.repeat(36),
};
const envLine = (text: string, file = '.env') => ({ file, line: 1, text });
const envKinds = (texts: string[], file?: string) => scanSecrets(texts.map((t) => envLine(t, file))).map((f) => f.kind);

describe('scanSecrets: provider shapes added by decision 43', () => {
  it('finds Stripe secret and restricted live keys', () => {
    expect(kinds([more.stripe, more.stripeRestricted])).toEqual(['stripe-key', 'stripe-key']);
  });

  it('needs a Stripe key to be live and at least 24 characters after the prefix', () => {
    expect(kinds([['sk', 'test', 'Ab3'.repeat(8)].join('_'), ['sk', 'live', 'a'.repeat(23)].join('_'), ['pk', 'live', 'a'.repeat(30)].join('_')])).toEqual([]);
    expect(kinds([['sk', 'live', 'a'.repeat(24)].join('_')])).toEqual(['stripe-key']);
  });

  it('finds every Slack token type: xoxa, xoxb, xoxp, xoxo, xoxr and xoxs', () => {
    expect(kinds([...'abpors'].map((t) => ['xox' + t, '1234567890', 'abc'].join('-')))).toEqual(Array(6).fill('slack-token'));
  });

  it('needs a Slack token to have a known type letter and a body of 10 or more characters', () => {
    expect(kinds([['xox' + 'c', '1234567890'].join('-'), ['xox' + 'b', '123456789'].join('-'), 'xox' + 'b' + '1234567890'])).toEqual([]);
    expect(kinds([more.slack])).toEqual(['slack-token']);
  });

  it('finds a Google API key: AIza and exactly 35 more characters', () => {
    expect(kinds([more.google, `key=${more.google}&q=1`, 'AI' + 'za' + '-_'.repeat(17) + 'a'])).toEqual(['google-api-key', 'google-api-key', 'google-api-key']);
  });

  it('refuses a Google shape with 34 characters, or 36, after AIza', () => {
    expect(kinds(['AI' + 'za' + 'b'.repeat(34), 'AI' + 'za' + 'b'.repeat(36), 'xAI' + 'za' + 'b'.repeat(35)])).toEqual([]);
  });

  it('finds a JSON web token: three base64url parts, the first two starting with eyJ', () => {
    expect(kinds([more.jwt, `Authorization: Bearer ${more.jwt}`])).toEqual(['jwt', 'jwt']);
  });

  it('needs each JWT part to be at least 10 characters, and both header and payload to be JSON', () => {
    const [h, p, s] = more.jwt.split('.');
    expect(kinds([[h, p, 'short'].join('.'), [h, 'abc' + p, s].join('.'), [h, 'eyJabc', s].join('.'), [h, p].join('.')])).toEqual([]);
    expect(kinds([[h, p, 'a'.repeat(10)].join('.'), [h.slice(0, 13), p, s].join('.')])).toEqual(['jwt', 'jwt']);
  });

  it('finds GitHub OAuth (gho_) and server (ghs_) tokens', () => {
    expect(kinds([more.gho, more.ghs])).toEqual(['github-token', 'github-token']);
  });
});

describe('scanSecrets: unquoted KEY=value lines in .env files', () => {
  const value = 'q8Zr2LmP0vXy';

  it('finds an unquoted value with a digit and 12 or more characters', () => {
    expect(envKinds([`API_KEY=${value}`, `export  DB_URL=${value}x`, `  token = ${value} # prod`])).toEqual(['env-assignment', 'env-assignment', 'env-assignment']);
  });

  it('reports the value, shortened, never the whole of it', () => {
    expect(scanSecrets([envLine(`API_KEY=${value}`)])).toEqual([{ file: '.env', line: 1, kind: 'env-assignment', excerpt: 'q8Zr2L…' }]);
  });

  it('skips values under 12 characters or without a digit', () => {
    expect(envKinds(['API_KEY=q8Zr2LmP0vX', 'API_KEY=qaZrbLmPcvXyzz', 'DEBUG=true', 'PORT=3000'])).toEqual([]);
  });

  it('skips placeholders: your-key-here, changeme, xxx, example and placeholder, in any case', () => {
    expect(envKinds([
      'API_KEY=your-key-here-123',
      'API_KEY=CHANGEME12345678',
      'API_KEY=xxx-1234567890',
      'API_KEY=example-key-12345',
      'API_KEY=placeholder-12345',
    ])).toEqual([]);
  });

  it('reads every .env* file name: .env, .env.local, .envrc and nested ones', () => {
    for (const file of ['.env', '.env.local', '.envrc', 'apps/web/.env.production', 'apps\\web\\.env']) {
      expect(envKinds([`API_KEY=${value}`], file)).toEqual(['env-assignment']);
    }
  });

  it('leaves the same line alone outside .env files', () => {
    for (const file of ['src/a.ts', 'config.env', 'docs/env.md', 'my.env.local', 'config/.env/settings.ts', 'config\\.env\\settings.ts']) expect(envKinds([`API_KEY=${value}`], file)).toEqual([]);
  });

  it('leaves comments, quoted values and lines that are not assignments to the other patterns', () => {
    expect(envKinds([`# DB_URL=${value}`, `DB_URL="${value}"`, `DB_URL='${value}'`, `DB URL=${value}`, `=${value}`, `1DB=${value}`])).toEqual([]);
  });

  it('still reports a provider key in a .env file by its own kind', () => {
    expect(envKinds([`GITHUB_TOKEN=${fake.github}`])).toEqual(['github-token']);
  });
});
