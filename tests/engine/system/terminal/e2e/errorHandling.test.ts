import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { setupTestProject } from '../../../../_helpers/testProject';

/**
 * Error handling and exit status e2e tests
 *
 * Edge cases:
 * - set -e, set -u, and set -o pipefail behavior
 * - Error handling with traps
 * - Conditional execution (&&, ||)
 * - Exit status propagation
 * - Subshell error handling
 */

describe('e2e — error handling and exit status', () => {
  let rootPath: string;
  let testFs: Awaited<ReturnType<typeof setupTestProject>>['repo'];
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const ctx = await setupTestProject('ErrorHandlingE2ETest');
    rootPath = ctx.rootPath;
    testFs = ctx.repo;
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  async function executeScript(
    scriptContent: string,
    scriptName = 'test-script.sh'
  ): Promise<{
    output: string[];
    errors: string[];
    code: number;
    executionError: Error | null;
  }> {
    await testFs.writeFile(`${rootPath}/${scriptName}`, scriptContent);
    const result = await shell!.run(`bash ${scriptName}`);
    const code = result.code ?? 0;
    let executionError: Error | null = null;
    if (code !== 0) {
      executionError = new Error(`Script exited with code ${code}\n${result.stderr}`);
    }
    return {
      output: result.stdout.split('\n').filter(Boolean),
      errors: result.stderr.split('\n').filter(Boolean),
      code,
      executionError,
    };
  }

  function assertNoUnexpectedErrors(
    output: string[],
    errors: string[],
    executionError: Error | null
  ) {
    const allOutput = [...output, ...errors].join('\n');

    // Check for fatal errors, except in intentional error cases
    expect(allOutput).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(allOutput).not.toContain('Cannot find module');
    expect(allOutput).not.toContain('Module execution failed');
    expect(allOutput).not.toContain('SyntaxError');
    expect(allOutput).not.toContain('ReferenceError');
    expect(allOutput).not.toContain('TypeError');

    // Ensure execution errors are not module resolution failures
    if (executionError) {
      expect(executionError.message).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(executionError.message).not.toContain('Cannot find module');
    }
  }

  describe('set -e (errexit) behavior', () => {
    it('set -e stops the script after a command fails', async () => {
      const script = `#!/bin/bash
set -e
echo "before error"
false
echo "after error - should not appear"
`;
      const { output, code } = await executeScript(script, 'test-set-e.sh');

      expect(output).toEqual(['before error']);
      expect(code).toBe(1);
    }, 30000);

    it('|| handles failure while set -e is enabled', async () => {
      const script = `#!/bin/bash
set -e
echo "start"
false || echo "caught error"
echo "continued"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('start');
      expect(result).toContain('caught error');
      expect(result).toContain('continued');
    }, 30000);

    it('Subshell failure with set -e', async () => {
      const script = `#!/bin/bash
set -e
echo "before subshell"
(false) || echo "subshell failed"
echo "after subshell"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('before subshell');
      expect(result).toContain('subshell failed');
      expect(result).toContain('after subshell');
    }, 30000);

    it('set +e disables errexit', async () => {
      const script = `#!/bin/bash
set -e
echo "with errexit"
set +e
false
echo "error ignored"
set -e
echo "errexit re-enabled"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('with errexit');
      expect(result).toContain('error ignored');
      expect(result).toContain('errexit re-enabled');
    }, 30000);
  });

  describe('set -u (nounset) behavior', () => {
    it('set -u errors on an undefined variable reference', async () => {
      const script = `#!/bin/bash
set -u
echo "start"
echo "$UNDEFINED_VAR"
echo "end"
`;
      const { output, errors, code } = await executeScript(script);

      expect(code).not.toBe(0);
      expect(output).toEqual(['start']);
      expect(errors.join('\n')).toContain('UNDEFINED_VAR');
    }, 30000);

    it('${var:-default} works with set -u', async () => {
      const script = `#!/bin/bash
set -u
unset MY_VAR
echo "value: \${MY_VAR:-fallback}"
MY_VAR="set"
echo "value: \${MY_VAR:-fallback}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('value: fallback');
      expect(result).toContain('value: set');
    }, 30000);

    it('set -u distinguishes empty and unset variables', async () => {
      const script = `#!/bin/bash
set -u
EMPTY=""
echo "empty is set: \${EMPTY+yes}"
unset NOTSET
echo "notset is set: \${NOTSET+yes}"
echo "notset default: \${NOTSET:-no}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('empty is set: yes');
      expect(result).toContain('notset is set:');
      expect(result).toContain('notset default: no');
    }, 30000);
  });

  describe('set -o pipefail behavior', () => {
    it('keeps pipeline stage statuses when negating the pipefail result', async () => {
      const script = `#!/bin/bash
set -o pipefail
false | false | true
printf 'plain:%s:%s\\n' "$?" "\${PIPESTATUS[*]}"
! false | false | true
printf 'negated:%s:%s\\n' "$?" "\${PIPESTATUS[*]}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);
      expect(output).toEqual(['plain:1:1 1 0', 'negated:0:1 1 0']);
    }, 30000);

    it('set -o pipefail detects a failed pipeline command', async () => {
      const script = `#!/bin/bash
set -o pipefail
echo "test" | grep "nonexistent" | cat
STATUS=$?
echo "exit status: $STATUS"
`;
      const { output } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('exit status:');
      // grep fails, so the status is nonzero
      expect(result).not.toContain('exit status: 0');
    }, 30000);

    it('Combining set -o pipefail and set -e', async () => {
      const script = `#!/bin/bash
set -eo pipefail
echo "before"
(echo "test" | grep "ok" | cat) || echo "pipeline failed"
echo "after"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('before');
      expect(result).toContain('pipeline failed');
      expect(result).toContain('after');
    }, 30000);

    it('A successful pipeline returns status 0 with set -o pipefail', async () => {
      const script = `#!/bin/bash
set -o pipefail
echo "hello world" | grep "hello" | wc -l
echo "status: $?"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('status: 0');
    }, 30000);
  });

  describe('Error handling with traps', () => {
    it('ERR trap handles a command failure', async () => {
      const script = `#!/bin/bash
trap 'echo "Error caught on line $LINENO"' ERR
set -E
echo "start"
false
echo "continued after error"
`;
      const { output } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('start');
      expect(result).toContain('Error caught on line');
      expect(result).toContain('continued after error');
    }, 30000);

    it('EXIT trap runs when the script exits', async () => {
      const script = `#!/bin/bash
trap 'echo "cleanup executed"' EXIT
echo "main process"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('main process');
      expect(result).toContain('cleanup executed');
    }, 30000);

    it('EXIT trap observes and preserves an explicit exit status', async () => {
      const script = `#!/bin/bash
trap 'echo "exit:$?"; false' EXIT
exit 37
`;
      const { output, code } = await executeScript(script);

      expect(output).toEqual(['exit:37']);
      expect(code).toBe(37);
    }, 30000);

    it('rejects trap registration for unsupported signals', async () => {
      const { output, errors, code } = await executeScript(
        `#!/bin/bash
trap 'echo "termination signal received"' INT TERM EXIT
`
      );

      expect(code).toBe(1);
      expect(errors.join('\n')).toContain('trap: unsupported signal specification: INT');
      expect(output).not.toContain('termination signal received');
    }, 30000);

    it('ERR and EXIT traps preserve the observed status', async () => {
      const script = `#!/bin/bash
trap 'echo "err:$?"' ERR
trap 'echo "exit:$?"' EXIT
fail() { return 42; }
echo "before"
fail
status=$?
echo "after:$status"
`;
      const { output } = await executeScript(script);

      expect(output).toEqual(['before', 'err:42', 'after:42', 'exit:0']);
    }, 30000);

    it('Removing a trap prevents its handler from running', async () => {
      const script = `#!/bin/bash
trap 'echo trapped' ERR
trap 'echo unexpected-exit' EXIT
false
trap - ERR
trap - EXIT
false
echo status:$?
exit 23
`;
      const { output, errors, code, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);
      expect(output).toEqual(['trapped', 'status:1']);
      expect(code).toBe(23);
    }, 30000);

    it('set -E inherits ERR traps inside functions', async () => {
      const script = `#!/bin/bash
trap 'echo "err:$?"' ERR
fail() { false; echo continued; }
fail
set -E
fail
`;
      const { output, code } = await executeScript(script);

      expect(code).toBe(0);
      expect(output).toEqual(['continued', 'err:1', 'continued']);
    }, 30000);
  });

  describe('Conditional execution (&& and ||)', () => {
    it('ERR traps do not run for failures used by &&, ||, or if conditions', async () => {
      const script = `#!/bin/bash
set -e
trap 'echo unexpected-err' ERR
false && echo skipped
false || echo recovered
if false; then echo skipped; else echo alternative; fi
echo done
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);
      expect(output).toEqual(['recovered', 'alternative', 'done']);
    }, 30000);

    it('set -eE does not trigger ERR traps for a function used as an OR condition', async () => {
      const script = `#!/bin/bash
set -eE
trap 'echo unexpected-err' ERR
fail() { false; echo function-continued; }
fail || echo recovered
echo done
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);
      expect(output).toEqual(['function-continued', 'done']);
    }, 30000);

    it('&& chains successful commands', async () => {
      const script = `#!/bin/bash
true && echo "step1" && echo "step2" && echo "step3"
echo "done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('step1');
      expect(result).toContain('step2');
      expect(result).toContain('step3');
      expect(result).toContain('done');
    }, 30000);

    it('&& skips commands after a failure', async () => {
      const script = `#!/bin/bash
true && echo "step1" && false && echo "step2"
echo "done"
`;
      const { output } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('step1');
      expect(result).not.toContain('step2');
      expect(result).toContain('done');
    }, 30000);

    it('|| runs fallback commands', async () => {
      const script = `#!/bin/bash
false || echo "fallback1"
true || echo "fallback2"
echo "done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('fallback1');
      expect(result).not.toContain('fallback2');
      expect(result).toContain('done');
    }, 30000);

    it('Combining && and || for control flow', async () => {
      const script = `#!/bin/bash
(false || echo "recovered") && echo "continued" || echo "failed"
echo "done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('recovered');
      expect(result).toContain('continued');
      expect(result).not.toContain('failed');
      expect(result).toContain('done');
    }, 30000);

    it('Combining command groups and conditional execution', async () => {
      const script = `#!/bin/bash
{ echo "group1"; true; } && echo "success1"
{ echo "group2"; false; } && echo "success2"
echo "done"
`;
      const { output } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('group1');
      expect(result).toContain('success1');
      expect(result).toContain('group2');
      expect(result).not.toContain('success2');
      expect(result).toContain('done');
    }, 30000);
  });

  describe('Explicit exit status control', () => {
    it('exit returns an explicit status', async () => {
      const script = `#!/bin/bash
echo "before exit"
exit 0
echo "after exit - unreachable"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('before exit');
      expect(result).not.toContain('unreachable');
    }, 30000);

    it('$? captures a subshell status', async () => {
      const script = `#!/bin/bash
(exit 42)
echo "subshell exit code: $?"
(exit 0)
echo "subshell exit code: $?"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('subshell exit code: 42');
      expect(result).toContain('subshell exit code: 0');
    }, 30000);

    it('return sets a function status', async () => {
      const script = `#!/bin/bash
test_func() {
  echo "in function"
  return 99
}
test_func
echo "function exit code: $?"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('in function');
      expect(result).toContain('function exit code: 99');
    }, 30000);

    it('Functions restore positional parameters and return the last status by default', async () => {
      const script = `#!/bin/bash
inner() {
  echo "inner:$1:$#"
  false
  return
  echo unreachable
}
inner argument
printf 'status:%s args:%s\n' "$?" "$*"
`;
      await testFs.writeFile(`${rootPath}/function-args.sh`, script);
      const result = await shell!.run('bash function-args.sh outer first');

      expect(result.code ?? 0).toBe(0);
      expect(result.stdout.split('\n').filter(Boolean)).toEqual([
        'inner:argument:1',
        'status:1 args:outer first',
      ]);
    }, 30000);

    it('$PIPESTATUS contains each pipeline command status', async () => {
      const script = `#!/bin/bash
echo "test" | false | true
echo "pipe statuses: \${PIPESTATUS[@]}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('pipe statuses: 0 1 0');
    }, 30000);
  });

  describe('Error messages and debugging', () => {
    it('set -x enables command tracing', async () => {
      const script = `#!/bin/bash
set -x
VAR="test"
echo "$VAR"
set +x
echo "trace disabled"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('test');
      expect(result).toContain('trace disabled');
    }, 30000);

    it('Commands can write messages to stderr', async () => {
      const script = `#!/bin/bash
echo "stdout message"
echo "stderr message" >&2
echo "done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      expect(output).toEqual(['stdout message', 'done']);
      expect(errors).toEqual(['stderr message']);
    }, 30000);

    it('Commands can format multiline messages on stderr', async () => {
      const script = `#!/bin/bash
cat >&2 <<EOF
ERROR: Something went wrong
Details:
  - Item 1
  - Item 2
EOF
echo "recovery attempted"
`;
      const { output, errors } = await executeScript(script);

      const allOutput = [...output, ...errors].join('\n');
      expect(allOutput).toContain('Something went wrong');
      expect(allOutput).toContain('recovery attempted');
    }, 30000);

    it('Quoting a heredoc delimiter disables expansion', async () => {
      const script = `#!/bin/bash
value=expanded
cat <<'QUOTED'
$value $(echo command) $((1 + 2))
QUOTED
cat <<UNQUOTED
$value $(echo command) $((1 + 2))
UNQUOTED
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);
      expect(output).toEqual(['$value $(echo command) $((1 + 2))', 'expanded command 3']);
    }, 30000);
  });
});
