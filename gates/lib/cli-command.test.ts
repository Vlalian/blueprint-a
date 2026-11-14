import { describe, expect, it } from 'vitest';
import { claudeCommand, resolveClaudeCli } from './cli-command.ts';

describe('resolveClaudeCli and claudeCommand', () => {
  it('prefers CLAUDE_CLI, then the native exe, then cli.js', () => {
    expect(resolveClaudeCli({ CLAUDE_CLI: 'C:/x/claude.exe', APPDATA: 'A' }, () => false)).toBe('C:/x/claude.exe');
    expect(resolveClaudeCli({ APPDATA: 'A' }, (p) => p.endsWith('claude.exe'))).toMatch(/bin[\\/]claude\.exe$/);
    expect(resolveClaudeCli({ APPDATA: 'A' }, (p) => p.endsWith('cli.js'))).toMatch(/cli\.js$/);
    expect(resolveClaudeCli({ APPDATA: 'A' }, () => false)).toBe('');
  });

  it('looks in the npm install under APPDATA, or under the current folder without one', () => {
    expect(resolveClaudeCli({ APPDATA: 'C:/work/user/AppData/Roaming' }, (p) => p.endsWith('claude.exe'))).toBe('C:/work/user/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe');
    expect(resolveClaudeCli({}, (p) => p.endsWith('cli.js'))).toBe('npm/node_modules/@anthropic-ai/claude-code/cli.js');
  });

  it('runs a .js entry under node and an exe directly', () => {
    expect(claudeCommand('C:/c/cli.js', ['-p'], 'node.exe')).toEqual(['node.exe', ['C:/c/cli.js', '-p']]);
    expect(claudeCommand('C:/c/claude.exe', ['-p'], 'node.exe')).toEqual(['C:/c/claude.exe', ['-p']]);
  });

  it('runs any JS entry under node, whatever its case or module extension', () => {
    expect(claudeCommand('C:/c/CLI.JS', ['-p'], 'node.exe')).toEqual(['node.exe', ['C:/c/CLI.JS', '-p']]);
    expect(claudeCommand('C:/c/cli.mjs', [], 'node.exe')).toEqual(['node.exe', ['C:/c/cli.mjs']]);
    expect(claudeCommand('C:/c/cli.cjs', [], 'node.exe')).toEqual(['node.exe', ['C:/c/cli.cjs']]);
    expect(claudeCommand('C:/c/cli.json', [], 'node.exe')).toEqual(['C:/c/cli.json', []]);
  });
});
