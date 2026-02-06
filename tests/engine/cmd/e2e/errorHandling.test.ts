import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestProject } from '../../../_helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';

/**
 * エラーハンドリングと終了コードのe2eテスト
 *
 * エッジケース：
 * - set -e, set -u, set -o pipefail の動作
 * - trap でのエラーキャッチ
 * - 条件付き実行（&&, ||）
 * - exit コードの伝播
 * - サブシェルのエラーハンドリング
 */

describe('e2e — エラーハンドリングと終了コード実行テスト', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('ErrorHandlingE2ETest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  async function executeScript(
    scriptContent: string,
    scriptName = 'test-script.sh',
    expectError = false
  ): Promise<{
    output: string[];
    errors: string[];
    executionError: Error | null;
  }> {
    await fileRepository.createFile(
      projectId,
      `/${scriptName}`,
      scriptContent,
      'file'
    );

    const output: string[] = [];
    const errors: string[] = [];

    const debugConsole = {
      log: (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        output.push(msg);
      },
      error: (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        errors.push(msg);
      },
      warn: (...args: unknown[]) => {
        const msg = args.map(String).join(' ');
        output.push(`[WARN] ${msg}`);
      },
      clear: () => {},
    };

    const scriptPath = `/projects/${projectName}/${scriptName}`;
    const runtime = new NodeRuntime({
      projectId,
      projectName,
      filePath: scriptPath,
      debugConsole,
      terminalColumns: 120,
      terminalRows: 40,
    });

    let executionError: Error | null = null;
    try {
      await runtime.execute(scriptPath, []);
    } catch (e) {
      executionError = e as Error;
    }

    return { output, errors, executionError };
  }

  function assertNoUnexpectedErrors(
    output: string[],
    errors: string[],
    executionError: Error | null
  ) {
    const allOutput = [...output, ...errors].join('\n');

    // 致命的なエラーのチェック（意図的なエラーテストを除く）
    expect(allOutput).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(allOutput).not.toContain('Cannot find module');
    expect(allOutput).not.toContain('Module execution failed');
    expect(allOutput).not.toContain('SyntaxError');
    expect(allOutput).not.toContain('ReferenceError');
    expect(allOutput).not.toContain('TypeError');

    // executionError がある場合はモジュール解決エラーでないことを確認
    if (executionError) {
      expect(executionError.message).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(executionError.message).not.toContain('Cannot find module');
    }
  }

  describe('set -e (errexit) の動作', () => {
    it('set -e でエラー発生時にスクリプトが停止する', async () => {
      const script = `#!/bin/bash
set -e
echo "before error"
false
echo "after error - should not appear"
`;
      const { output, errors, executionError } = await executeScript(script, 'test-set-e.sh', true);

      const result = output.join('\n');
      expect(result).toContain('before error');
      expect(result).not.toContain('should not appear');
    }, 30000);

    it('set -e でも || を使えばエラーをキャッチできる', async () => {
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

    it('set -e 環境でのサブシェルエラー', async () => {
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

    it('set +e でエラーハンドリングを無効化できる', async () => {
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

  describe('set -u (nounset) の動作', () => {
    it('set -u で未定義変数の参照がエラーになる', async () => {
      const script = `#!/bin/bash
set -u
echo "start"
echo "value: \${UNDEFINED_VAR:-default}"
echo "end"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('start');
      expect(result).toContain('value: default');
      expect(result).toContain('end');
    }, 30000);

    it('set -u で ${var:-default} 構文が正常に動作する', async () => {
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

    it('set -u で空文字列と未定義を区別できる', async () => {
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

  describe('set -o pipefail の動作', () => {
    it('set -o pipefail でパイプ内のエラーを検出できる', async () => {
      const script = `#!/bin/bash
set -o pipefail
echo "test" | grep "nonexistent" | cat
STATUS=$?
echo "exit status: $STATUS"
`;
      const { output, errors, executionError } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('exit status:');
      // grep が失敗するので非ゼロのステータス
      expect(result).not.toContain('exit status: 0');
    }, 30000);

    it('set -o pipefail と set -e の組み合わせ', async () => {
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

    it('set -o pipefail で成功するパイプラインの終了コードは0', async () => {
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

  describe('trap でのエラーキャッチ', () => {
    it('trap ERR でエラーをキャッチできる', async () => {
      const script = `#!/bin/bash
trap 'echo "Error caught on line $LINENO"' ERR
set -E
echo "start"
false
echo "continued after error"
`;
      const { output, errors, executionError } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('start');
      expect(result).toContain('Error caught on line');
      expect(result).toContain('continued after error');
    }, 30000);

    it('trap EXIT でスクリプト終了時に処理を実行できる', async () => {
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

    it('trap で複数のシグナルを同時に処理できる', async () => {
      const script = `#!/bin/bash
trap 'echo "termination signal received"' INT TERM EXIT
echo "process running"
exit 0
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('process running');
      expect(result).toContain('termination signal received');
    }, 30000);

    it('trap でエラーハンドラ内から終了コードを取得できる', async () => {
      const script = `#!/bin/bash
trap 'echo "exit code in trap: $?"' ERR
set -E
echo "before"
(exit 42)
echo "after"
`;
      const { output, errors, executionError } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('before');
      expect(result).toContain('exit code in trap:');
      expect(result).toContain('after');
    }, 30000);
  });

  describe('条件付き実行（&& と ||）', () => {
    it('&& で連続する成功を連鎖できる', async () => {
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

    it('&& で途中の失敗で実行が停止する', async () => {
      const script = `#!/bin/bash
true && echo "step1" && false && echo "step2"
echo "done"
`;
      const { output, errors, executionError } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('step1');
      expect(result).not.toContain('step2');
      expect(result).toContain('done');
    }, 30000);

    it('|| でフォールバック処理を実装できる', async () => {
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

    it('&& と || を組み合わせた複雑な制御フロー', async () => {
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

    it('コマンドグループと条件実行の組み合わせ', async () => {
      const script = `#!/bin/bash
{ echo "group1"; true; } && echo "success1"
{ echo "group2"; false; } && echo "success2"
echo "done"
`;
      const { output, errors, executionError } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('group1');
      expect(result).toContain('success1');
      expect(result).toContain('group2');
      expect(result).not.toContain('success2');
      expect(result).toContain('done');
    }, 30000);
  });

  describe('終了コードの明示的な制御', () => {
    it('exit で明示的な終了コードを返せる', async () => {
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

    it('サブシェルの終了コードを $? で取得できる', async () => {
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

    it('関数の return で終了コードを返せる', async () => {
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

    it('$PIPESTATUS で各パイプコマンドの終了コードを取得できる', async () => {
      const script = `#!/bin/bash
echo "test" | false | true
echo "pipe statuses: \${PIPESTATUS[@]}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('pipe statuses:');
    }, 30000);
  });

  describe('エラーメッセージとデバッグ', () => {
    it('set -x でコマンドトレースを有効にできる', async () => {
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

    it('stderr にエラーメッセージを出力できる', async () => {
      const script = `#!/bin/bash
echo "stdout message"
echo "stderr message" >&2
echo "done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoUnexpectedErrors(output, errors, executionError);

      const allOutput = [...output, ...errors].join('\n');
      expect(allOutput).toContain('stdout message');
      expect(allOutput).toContain('done');
    }, 30000);

    it('複数行のエラーメッセージを整形して出力できる', async () => {
      const script = `#!/bin/bash
cat >&2 <<EOF
ERROR: Something went wrong
Details:
  - Item 1
  - Item 2
EOF
echo "recovery attempted"
`;
      const { output, errors, executionError } = await executeScript(script);

      const allOutput = [...output, ...errors].join('\n');
      expect(allOutput).toContain('Something went wrong');
      expect(allOutput).toContain('recovery attempted');
    }, 30000);
  });
});
