import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { commandsOf, program, readLine, tokenize } from './shell-parse.ts';

const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

describe('tokenize', () => {
  it('splits on whitespace and keeps quoted text together, without the quotes', () => {
    expect(tokenize(`git commit -m "two words" -m 'more here'`)).toEqual(['git', 'commit', '-m', 'two words', '-m', 'more here']);
  });

  it('handles escaped quotes and adjacent quoted parts', () => {
    expect(tokenize(String.raw`echo "a \"b\" c" x'y'z`)).toEqual(['echo', 'a "b" c', 'xyz']);
  });

  it('keeps the other quote inside quotes, and backslashes inside single quotes', () => {
    expect(tokenize(`echo "it's" 'say "hi"' 'a\\b'`)).toEqual(['echo', "it's", 'say "hi"', 'a\\b']);
  });

  it('drops the separators', () => {
    expect(tokenize('a; b && c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps an empty quoted word, and drops runs of whitespace', () => {
    expect(tokenize(`echo ""  \t x`)).toEqual(['echo', '', 'x']);
  });

  // Ticket 36: Next.js route folders. sh refuses a bare `(` inside a word as a syntax error, so a
  // command the word seems to hide never runs.
  it('keeps a route folder in parentheses inside a path word in sh, quoted or not', () => {
    expect(tokenize('npm test -- src/app/[locale]/(app)/x.test.tsx')).toEqual(['npm', 'test', '--', 'src/app/[locale]/(app)/x.test.tsx']);
    expect(tokenize('npm test -- "src/app/(app)/x.test.tsx"')).toEqual(['npm', 'test', '--', 'src/app/(app)/x.test.tsx']);
    expect(tokenize('a src/(b)/(c)/d')).toEqual(['a', 'src/(b)/(c)/d']);
  });

  it('keeps intercepting route folders and dashes, and an empty group', () => {
    expect(tokenize('a src/(..)(..)/b-c/(x-y)/()/z')).toEqual(['a', 'src/(..)(..)/b-c/(x-y)/()/z']);
  });

  it('still splits at a parenthesis that does not open a plain folder name in a path word', () => {
    expect(tokenize('a (b) src(c) <(d) $(e)')).toEqual(['a', 'b', 'src', 'c', '<', 'd', '$', 'e']);
    expect(tokenize('a src/(b c) d)')).toEqual(['a', 'src/', 'b', 'c', 'd']);
    expect(tokenize('a src/(b;c)')).toEqual(['a', 'src/', 'b', 'c']);
    expect(tokenize('a src/(b')).toEqual(['a', 'src/', 'b']);
    expect(tokenize('a src/ (b)')).toEqual(['a', 'src/', 'b']);
    expect(tokenize('a b) src/x)')).toEqual(['a', 'b', 'src/x']);
    expect(commandsOf('npm test -- src/(git push)')).toEqual([['npm', 'test', '--', 'src/'], ['git', 'push']]);
    expect(commandsOf('npm test -- src/x(git)')).toEqual([['npm', 'test', '--', 'src/x'], ['git']]);
  });

  it('reads parentheses as separators in PowerShell and cmd', () => {
    expect(tokenize('a src/(b)/c', 'powershell')).toEqual(['a', 'src/', 'b', '/c']);
    expect(tokenize('a src/(b)/c', 'cmd')).toEqual(['a', 'src/', 'b', '/c']);
  });

  it('reads a backslash outside quotes as an escape in sh', () => {
    expect(tokenize(String.raw`echo a\ b \$x`)).toEqual(['echo', 'a b', '$x']);
  });

  it('reads PowerShell: backslashes are path characters, the backtick escapes', () => {
    expect(tokenize(String.raw`rm C:\proj\CONTEXT.md`, 'powershell')).toEqual(['rm', String.raw`C:\proj\CONTEXT.md`]);
    expect(tokenize('echo a` b "c`"d"', 'powershell')).toEqual(['echo', 'a b', 'c"d']);
  });

  it('reads cmd: the caret escapes and a single quote is an ordinary character', () => {
    expect(tokenize(`echo it's g^it`, 'cmd')).toEqual(['echo', "it's", 'git']);
  });
});

describe('program', () => {
  it.each([
    ['git', 'git'],
    ['/usr/bin/git', 'git'],
    [String.raw`C:\Program Files\Git\bin\git.exe`, 'git'],
    ['GIT', 'git'],
    ['git.CMD', 'git'],
    ['git.bat', 'git'],
    ['a.exe.b', 'a.exe.b'],
    ['exe', 'exe'],
  ])('reads %s as %s', (word, name) => {
    expect(program(word)).toBe(name);
  });
});

describe('commandsOf', () => {
  it('splits a line into simple commands on ; && || | & ( ) and newlines, respecting quotes', () => {
    expect(commandsOf(`npm test && git push; echo "a;b" | cat\ngit status`)).toEqual([
      ['npm', 'test'],
      ['git', 'push'],
      ['echo', 'a;b'],
      ['cat'],
      ['git', 'status'],
    ]);
    expect(commandsOf('a || b & c (d) e')).toEqual([['a'], ['b'], ['c'], ['d'], ['e']]);
  });

  it('reads subshells and groups, and does not split on braces in sh', () => {
    expect(commandsOf('(git push --force)')).toEqual([['git', 'push', '--force']]);
    expect(commandsOf('{ git push; }')).toEqual([['git', 'push']]);
    expect(commandsOf('echo {a,b}')).toEqual([['echo', '{a,b}']]);
  });

  it('reads a PowerShell script block as commands', () => {
    expect(commandsOf('Invoke-Command -ScriptBlock {git push --force}', 'powershell')).toEqual([
      ['Invoke-Command', '-ScriptBlock'],
      ['git', 'push', '--force'],
    ]);
  });

  it('reads cmd separators past a lone single quote, and double quotes as quotes', () => {
    expect(commandsOf(`echo it's & git push --force`, 'cmd')).toEqual([['echo', "it's"], ['git', 'push', '--force']]);
    expect(commandsOf(`echo "a & b"`, 'cmd')).toEqual([['echo', 'a & b']]);
  });

  it('drops leading environment assignments and harmless wrappers', () => {
    expect(commandsOf('GIT_DIR=x FOO=1 env BAR=2 command nohup git push')).toEqual([['git', 'push']]);
    expect(commandsOf('foo=1 _X=2 A1_B=3 git push')).toEqual([['git', 'push']]);
  });

  it('keeps words that only look like assignments', () => {
    expect(commandsOf('1A=2 git push')).toEqual([['1A=2', 'git', 'push']]);
    expect(commandsOf('a.b=1 git push')).toEqual([['a.b=1', 'git', 'push']]);
  });

  it('returns nothing for a line of only assignments or wrappers', () => {
    expect(commandsOf('FOO=1')).toEqual([]);
    expect(commandsOf('env')).toEqual([]);
    expect(commandsOf('sudo -E')).toEqual([]);
  });

  it('keeps a numbered redirection after a wrapper as a command, so its target is still seen', () => {
    expect(commandsOf('exec 3>CONTEXT.md')).toEqual([['3>CONTEXT.md']]);
    expect(commandsOf('exec 3<>CONTEXT.md')).toEqual([['3<>CONTEXT.md']]);
    expect(commandsOf('exec 3<x')).toEqual([['3<x']]);
    expect(commandsOf('timeout 10 git push')).toEqual([['git', 'push'], ['push']]);
  });

  it.each(['env', 'command', 'builtin', 'nohup', 'time', 'exec', 'sudo', 'xargs', 'nice', 'timeout', 'wsl'])('sees through the wrapper %s', (wrapper) => {
    expect(commandsOf(`${wrapper} git push --force`)).toEqual([['git', 'push', '--force']]);
  });

  it.each(['!', '{', '}', 'if', 'then', 'else', 'elif', 'do', 'while', 'until'])('sees past the keyword %s', (keyword) => {
    expect(commandsOf(`${keyword} git push --force`)).toEqual([['git', 'push', '--force']]);
  });

  it('reads the commands inside if, while and for bodies', () => {
    expect(commandsOf('if true; then git push --force; fi')).toEqual([['true'], ['git', 'push', '--force'], ['fi']]);
  });

  it("tries each word after a wrapper's options, since an option may take a value", () => {
    expect(commandsOf('sudo -u root git push')).toEqual([
      ['root', 'git', 'push'],
      ['git', 'push'],
    ]);
    expect(commandsOf('timeout 10 git push')).toEqual([
      ['git', 'push'],
      ['push'],
    ]);
    expect(commandsOf('xargs -n 1 -I {} git push')).toEqual([
      ['{}', 'git', 'push'],
      ['git', 'push'],
    ]);
    expect(commandsOf('sudo x-y git push')).toEqual([['x-y', 'git', 'push']]);
    expect(commandsOf('sudo a1 git push')).toEqual([['a1', 'git', 'push']]);
  });

  it('follows a chain of wrappers, each with its own options', () => {
    expect(commandsOf('nice -n 5 sudo -E env A=1 git status')).toEqual([['git', 'status']]);
  });

  it('reads a long chain of wrappers in linear time', () => {
    const start = performance.now();
    expect(commandsOf(`${'sudo -x '.repeat(30_000)}git status`)).toContainEqual(['git', 'status']);
    expect(performance.now() - start).toBeLessThan(3000);
  });

  it('keeps the words as written, and knows wrappers and shells by program name', () => {
    expect(commandsOf(`/usr/bin/git push`)).toEqual([['/usr/bin/git', 'push']]);
    expect(commandsOf(String.raw`'C:\Git\bin\git.exe' push`)).toEqual([[String.raw`C:\Git\bin\git.exe`, 'push']]);
    expect(commandsOf('/usr/bin/env SUDO.EXE git push')).toEqual([['git', 'push']]);
    expect(commandsOf(`/bin/BASH -c 'git push'`)).toEqual([['git', 'push']]);
  });

  it('looks inside sh -c, bash -c and powershell -Command strings', () => {
    expect(commandsOf(`sh -c "git push --force"`)).toEqual([['git', 'push', '--force']]);
    expect(commandsOf(`bash -lc 'cd x && git reset --hard'`)).toEqual([['cd', 'x'], ['git', 'reset', '--hard']]);
    expect(commandsOf(`powershell -Command "git push -f"`)).toEqual([['git', 'push', '-f']]);
  });

  it.each(['sh', 'bash', 'zsh', 'dash', 'ksh'])('reads %s -c as sh', (shell) => {
    expect(commandsOf(`${shell} -c 'echo a\\ b'`)).toEqual([['echo', 'a b']]);
  });

  it.each(['powershell', 'pwsh', 'PowerShell.exe'])('reads %s -Command as PowerShell', (shell) => {
    expect(commandsOf(String.raw`${shell} -Command 'Remove-Item C:\proj\CONTEXT.md'`)).toEqual([['Remove-Item', String.raw`C:\proj\CONTEXT.md`]]);
  });

  it('reads cmd /c as cmd', () => {
    expect(commandsOf(`cmd /c "g^it push --force"`)).toEqual([['git', 'push', '--force']]);
    expect(commandsOf(`cmd.exe /K git push --force`)).toEqual([['git', 'push', '--force']]);
  });

  it.each(['-c', '-lc', '-xc', '-Command', '-command', '-com', '-COMM', '/c', '/C', '/k'])('takes %s as the flag before a script', (flag) => {
    expect(commandsOf(`pwsh ${flag} git push --force`)).toEqual([['git', 'push', '--force']]);
  });

  it.each(['-ca', 'x-c', '-x', '/ck', 'c', 'x-e', '-ex', '-ExecutionPolicy'])('does not take %s as a script flag', (flag) => {
    expect(commandsOf(`sh ${flag} 'git push --force'`)).toEqual([['sh', flag, 'git push --force']]);
  });

  it('does not look for a script in a program that is not a shell', () => {
    expect(commandsOf(`echo -c 'git push'`)).toEqual([['echo', '-c', 'git push']]);
    expect(commandsOf('bash script.sh')).toEqual([['bash', 'script.sh']]);
  });

  it.each(['-e', '-ec', '-enc', '-EncodedCommand'])('decodes powershell %s', (flag) => {
    expect(commandsOf(`powershell ${flag} ${encoded('git push --force')} extra`)).toContainEqual(['git', 'push', '--force']);
  });

  it('reads an encoded flag with no script as no command', () => {
    expect(commandsOf('powershell -enc')).toEqual([]);
  });

  it('reads an encoded command both as text and decoded', () => {
    const commands = commandsOf(`bash -ec 'git status'`);
    expect(commands[0]).toEqual(['git', 'status']);
    expect(commands).toHaveLength(2);
  });

  it('reads eval and Invoke-Expression arguments as a script', () => {
    expect(commandsOf(`eval "git push --force"`)).toEqual([['git', 'push', '--force']]);
    expect(commandsOf('eval git push --force')).toEqual([['git', 'push', '--force']]);
    expect(commandsOf(String.raw`iex 'Remove-Item C:\proj\x'`)).toEqual([['Remove-Item', String.raw`C:\proj\x`]]);
    expect(commandsOf(String.raw`Invoke-Expression 'Remove-Item C:\proj\x'`, 'powershell')).toEqual([['Remove-Item', String.raw`C:\proj\x`]]);
  });

  it('looks inside $( ) and backtick substitutions, quoted or not', () => {
    expect(commandsOf('echo $(git push --force)')).toEqual([['echo', '$'], ['git', 'push', '--force'], ['git', 'push', '--force']]);
    expect(commandsOf('echo "$(git push --force)"')).toEqual([['echo', '$(git push --force)'], ['git', 'push', '--force']]);
    expect(commandsOf('echo `git reset --hard`')).toEqual([['echo', '`git', 'reset', '--hard`'], ['git', 'reset', '--hard']]);
    expect(commandsOf('echo "$(git push)"', 'powershell')).toEqual([['echo', '$(git push)'], ['git', 'push']]);
    expect(commandsOf('echo "$(git push --force)"', 'cmd')).toEqual([['echo', '$(git push --force)'], ['git', 'push', '--force']]);
  });

  it('reads no backtick substitution in PowerShell or cmd', () => {
    expect(commandsOf('echo "a `"b`" c"', 'powershell')).toEqual([['echo', 'a "b" c']]);
    expect(commandsOf('echo `a b`', 'cmd')).toEqual([['echo', '`a', 'b`']]);
  });

  it('reads scripts nested up to eight deep, and refuses deeper ones', () => {
    expect(commandsOf(`${'eval '.repeat(8)}git status`)).toEqual([['git', 'status']]);
    expect(() => commandsOf(`${'eval '.repeat(9)}git status`)).toThrow('the command nests scripts more than 8 deep');
    expect(() => commandsOf(`echo "$(${'eval '.repeat(8)}git status)"`)).toThrow('the command nests scripts more than 8 deep');
  });

  it('returns nothing for an empty line', () => {
    expect(commandsOf('   ')).toEqual([]);
  });
});

describe('readLine', () => {
  it('gives the commands commandsOf gives, and every word with assignments kept', () => {
    const line = 'HUSKY=0 git commit -m x; env SKIP=lint git push';
    expect(readLine(line)).toEqual({
      commands: commandsOf(line),
      words: ['HUSKY=0', 'git', 'commit', '-m', 'x', 'env', 'SKIP=lint', 'git', 'push'],
    });
  });

  it('keeps the words of scripts inside scripts, substitutions and encoded commands', () => {
    expect(readLine(`sh -c 'A=1 git commit'`).words).toEqual(['sh', '-c', 'A=1 git commit', 'A=1', 'git', 'commit']);
    expect(readLine('echo $(B=2 git push)').words).toEqual(['echo', '$', 'B=2', 'git', 'push', 'B=2', 'git', 'push']);
    expect(readLine(`pwsh -enc ${encoded('$env:C=1')}`, 'sh').words).toContain('$env:C=1');
  });

  it('refuses scripts nested too deep, as commandsOf does', () => {
    const deep = Array.from({ length: 10 }).reduce<string>((inner) => `sh -c ${JSON.stringify(inner)}`, 'true');
    expect(() => readLine(deep)).toThrow(/nests scripts more than 8 deep/);
  });
});
