import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

describe('shell script status and options', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('ScriptRunnerTest');
    rootPath = project.rootPath;
    repo = project.repo;
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  it('returns the last command status when errexit is disabled', async () => {
    await repo.writeFile(`${rootPath}/status.sh`, 'true\ntest ""\n');

    const result = await shell!.run('bash status.sh');

    expect(result.code).toBe(1);
  });

  it('keeps errexit inactive for conditions and handled failures', async () => {
    await repo.writeFile(
      `${rootPath}/control.sh`,
      `set -e
if test ""; then
  echo "wrong branch"
else
  echo "condition handled"
fi
test "" || echo "failure handled"
echo "continued"
`
    );

    const result = await shell!.run('bash control.sh');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('condition handled\nfailure handled\ncontinued\n');
  });

  it('ignores a failed command guarded by a non-final AND list', async () => {
    await repo.writeFile(
      `${rootPath}/and-guard.sh`,
      'set -e\ntest "" && echo skipped\necho continued\n'
    );

    const result = await shell!.run('bash and-guard.sh');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('continued\n');
  });

  it('stops for a failure in the final command of an AND list', async () => {
    await repo.writeFile(`${rootPath}/and-final.sh`, 'set -e\ntrue && test ""\necho unreachable\n');

    const result = await shell!.run('bash and-final.sh');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('uses nounset with default parameter expansion and returns failure status', async () => {
    await repo.writeFile(
      `${rootPath}/nounset.sh`,
      `set -u
echo "\${UNDEFINED_VALUE:-fallback}"
echo "$UNDEFINED_VALUE"
echo "unreachable"
`
    );

    const result = await shell!.run('bash nounset.sh');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('fallback\n');
    expect(result.stderr).toContain('UNDEFINED_VALUE: unbound variable');
  });

  it('applies nounset to evaluated arithmetic variables without breaking lazy branches', async () => {
    await repo.writeFile(
      `${rootPath}/nounset-arithmetic.sh`,
      'set -u\necho "$((0 && MISSING))"\necho "$((1 ? 7 : MISSING))"\necho "$((MISSING + 1))"\necho unreachable\n'
    );

    const result = await shell!.run('bash nounset-arithmetic.sh');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('0\n7\n');
    expect(result.stderr).toContain('MISSING: unbound variable');
  });

  it('continues after an ordinary status 2 command with nounset enabled', async () => {
    await repo.writeFile(`${rootPath}/nounset-status.sh`, 'set -u\nsh\necho continued\n');

    const result = await shell!.run('bash nounset-status.sh');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('continued\n');
    expect(result.stderr).toContain('Usage: sh <file>');
  });

  it('applies pipefail when requested by the script', async () => {
    await repo.writeFile(`${rootPath}/pipefail.sh`, 'set -o pipefail\ntest "" | true\n');

    const result = await shell!.run('bash pipefail.sh');

    expect(result.code).toBe(1);
  });

  it('combines nounset, pipefail, errexit, functions and guarded conditions', async () => {
    await repo.writeFile(
      `${rootPath}/combined-options.sh`,
      `set -euo pipefail
printf '%s\\n' "\${MISSING_VALUE:-fallback}"
f() { false | true; echo inside; return 5; }
f || echo recovered
if false | true; then echo wrong; else echo conditional; fi
! false | true
echo done
`
    );

    const result = await shell!.run('bash combined-options.sh');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('fallback\ninside\nrecovered\nconditional\ndone\n');
  });

  it('executes conditional and nested loop control as builtins', async () => {
    const result = await shell!.run(
      'for i in 1 2 3; do [ "$i" = 2 ] && break; echo "$i"; done; for i in a b; do for j in x y; do echo "$i$j"; break 2; done; echo bad; done; echo after'
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('1\nax\nafter\n');
  });

  it('routes complete control commands through redirects and pipelines', async () => {
    const result = await shell!.run(
      'for i in then do done; do echo "$i"; done > words; cat words | while read item; do echo "$item"; done | wc -l'
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('3');
    const stored = await shell!.run('cat words');
    expect(stored.stdout).toBe('then\ndo\ndone\n');
  });

  it('reads Unicode lines, escaped fields and the original final field remainder', async () => {
    const result = await shell!.run(
      'printf \'日本語\\nlast\\n\' | while read -r item; do echo "$item"; done; printf \'a  b   c\\n\' | { read a b; printf \'<%s><%s>\\n\' "$a" "$b"; }; printf \'a\\\\ b c\\n\' | { read a b; printf \'<%s><%s>\\n\' "$a" "$b"; }'
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('日本語\nlast\n<a><b   c>\n<a b><c>\n');
  });

  it('sets positional arguments and iterates implicit for items without splitting them', async () => {
    const result = await shell!.run(
      'set -- "a b" c; echo "$#"; for item; do echo "$item"; done; set --; echo "$#"'
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('2\na b\nc\n0\n');
  });

  it('restores positional arguments after an inline function returns', async () => {
    const result = await shell!.run(
      'f() { printf "fn:%s:%s:%s\\n" "$#" "$1" "$2"; return 7; }; set -- outer keep; f a b; printf "after:%s:%s:%s:%s\\n" "$?" "$#" "$1" "$2"'
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('fn:2:a:b\nafter:7:2:outer:keep\n');
  });

  it('inverts a pipeline without applying errexit to its stages', async () => {
    await repo.writeFile(`${rootPath}/invert.sh`, 'set -e\n! true | true\necho after\n');
    const result = await shell!.run('bash invert.sh');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('after\n');
  });

  it('consumes loop control from while conditions before running the body', async () => {
    const result = await shell!.run('while break; do echo bad; done; echo after');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('after\n');
  });
  it('executes guarded continue and continue across two nested loops', async () => {
    const result = await shell!.run(
      'for i in 1 2 3; do [ "$i" = 2 ] && continue; echo "$i"; done; for i in a b; do for j in x y; do echo "$i$j"; true && continue 2; done; echo bad; done; echo after'
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('1\n3\nax\nbx\nafter\n');
  });

  it('protects ANSI-C literals while executing arithmetic and nested backtick substitutions', async () => {
    const result = await shell!.run(
      "printf '<%s>\\n' $'a\\tb $HOME * $(false)'; echo $((1+$(echo 2))); echo `echo \\`echo nested\\``"
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('<a\tb $HOME * $(false)>\n3\nnested\n');
  });

  it('stops on a fatal nounset expansion in a loop condition', async () => {
    await repo.writeFile(
      `${rootPath}/nounset-condition.sh`,
      'set -u\nwhile [ "$MISSING" ]; do echo bad; done\necho after\n'
    );
    const result = await shell!.run('bash nounset-condition.sh');
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('MISSING: unbound variable');
  });
  it('preserves nonwhite IFS remainder and backslash parity when reading records', async () => {
    await repo.writeFile(`${rootPath}/records`, 'one\\\\\ntwo\\\njoint\n');
    const result = await shell!.run(
      'while read item; do printf "<%s>\\n" "$item"; done < records; printf \'::a:b:c::\\n\' | { IFS=:; read x y; printf \'<%s><%s>\\n\' "$x" "$y"; }'
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('<one\\>\n<twojoint>\n<><:a:b:c::>\n');
  });

  it('reads a final unterminated line with an empty IFS', async () => {
    await repo.writeFile(`${rootPath}/no-final-newline`, 'one\ntwo');

    const result = await shell!.run(
      'IFS=; while read -r line || [ -n "$line" ]; do printf "<%s>\\n" "$line"; done < no-final-newline; printf "done\\n"'
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('<one>\n<two>\ndone\n');
  });
  it('propagates exit from a direct control body and clears it for the next invocation', async () => {
    const result = await shell!.run('for i in 1 2; do exit 3; done; echo unreachable');
    expect(result.code, result.stderr).toBe(3);
    expect(result.exitShell).toBe(true);
    expect(result.stdout).toBe('');
    const next = await shell!.run('echo available');
    expect(next.code, next.stderr).toBe(0);
    expect(next.stdout).toBe('available\n');
  });

  it('preserves logical loop control until its enclosing loop consumes it', async () => {
    const result = await shell!.run(
      'for i in 1 2 3; do [ "$i" = 2 ] || continue; echo "$i"; true && break; echo unreachable; done; echo after'
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('2\nafter\n');
    const next = await shell!.run('for i in a b; do echo "$i"; done');
    expect(next.code, next.stderr).toBe(0);
    expect(next.stdout).toBe('a\nb\n');
  });
  it('preserves the last status across trailing blank lines and comments', async () => {
    await repo.writeFile(
      `${rootPath}/comment-status.sh`,
      'false\n\n  # trailing comment\n# final comment\n'
    );
    const result = await shell!.run('bash comment-status.sh');
    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout).toBe('');
  });
});
