import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestProject } from '../../../_helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';

/**
 * サブシェルとコマンド置換のe2eテスト
 *
 * エッジケース：
 * - サブシェルのスコープと変数の分離
 * - コマンド置換の複雑なネスト
 * - バックティックと$()の違い
 * - 算術式展開
 * - サブシェル内でのエラー処理
 */

describe('e2e — サブシェルとコマンド置換実行テスト', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('SubshellE2ETest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  async function executeScript(scriptContent: string, scriptName = 'test-script.sh'): Promise<{
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

  function assertNoErrors(output: string[], errors: string[], executionError: Error | null) {
    const allOutput = [...output, ...errors].join('\n');

    expect(allOutput).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(allOutput).not.toContain('Cannot find module');
    expect(allOutput).not.toContain('Module execution failed');
    expect(allOutput).not.toContain('SyntaxError');
    expect(allOutput).not.toContain('ReferenceError');
    expect(allOutput).not.toContain('TypeError');
    expect(allOutput).not.toMatch(/ERROR:/i);
    expect(allOutput).not.toMatch(/\[ERROR\]/i);

    if (executionError) {
      throw new Error(
        `Execution failed: ${executionError.message}\nStack: ${executionError.stack}`
      );
    }

    if (errors.length > 0) {
      throw new Error(`Errors detected:\n${errors.join('\n')}`);
    }
  }

  describe('基本的なコマンド置換', () => {
    it('$() でコマンド置換ができる', async () => {
      const script = `#!/bin/bash
RESULT=\$(echo "hello")
echo "result: $RESULT"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('result: hello');
    }, 30000);

    it('バックティックでコマンド置換ができる', async () => {
      const script = `#!/bin/bash
RESULT=\`echo "world"\`
echo "result: $RESULT"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('result: world');
    }, 30000);

    it('コマンド置換の結果を直接使用できる', async () => {
      const script = `#!/bin/bash
echo "current dir: \$(pwd)"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('current dir:');
    }, 30000);

    it('複数行の出力をコマンド置換で取得できる', async () => {
      const script = `#!/bin/bash
LINES=\$(echo -e "line1\\nline2\\nline3")
echo "captured: $LINES"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('captured:');
      expect(result).toContain('line');
    }, 30000);
  });

  describe('ネストしたコマンド置換', () => {
    it('$() をネストできる', async () => {
      const script = `#!/bin/bash
RESULT=\$(echo "outer \$(echo "inner")")
echo "nested: $RESULT"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('nested: outer inner');
    }, 30000);

    it('3段階のネストしたコマンド置換', async () => {
      const script = `#!/bin/bash
RESULT=\$(echo "L1 \$(echo "L2 \$(echo "L3")")")
echo "three levels: $RESULT"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('three levels: L1 L2 L3');
    }, 30000);

    it('ネストしたコマンド置換でパイプを使用できる', async () => {
      const script = `#!/bin/bash
RESULT=\$(echo "test" | tr 'a-z' 'A-Z')
echo "result: $RESULT"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('result: TEST');
    }, 30000);

    it('複雑なネスト構造でコマンドを組み合わせる', async () => {
      const script = `#!/bin/bash
COUNT=\$(echo \$(seq 1 5 | wc -l))
echo "count: $COUNT"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('count: 5');
    }, 30000);
  });

  describe('サブシェルの基本動作', () => {
    it('サブシェル内の変数変更は外に影響しない', async () => {
      const script = `#!/bin/bash
VAR="original"
(VAR="modified"; echo "inside: $VAR")
echo "outside: $VAR"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('inside: modified');
      expect(result).toContain('outside: original');
    }, 30000);

    it('サブシェル内でcdしても外のディレクトリは変わらない', async () => {
      const script = `#!/bin/bash
ORIG=\$(pwd)
(cd /tmp; echo "inside: \$(pwd)")
echo "outside: \$(pwd)"
echo "same: \$([ "$ORIG" = "\$(pwd)" ] && echo "yes" || echo "no")"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('inside: /tmp');
      expect(result).toContain('same: yes');
    }, 30000);

    it('サブシェルは親の変数を読める', async () => {
      const script = `#!/bin/bash
PARENT_VAR="from parent"
(echo "child reads: $PARENT_VAR")
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('child reads: from parent');
    }, 30000);

    it('複数のサブシェルは独立している', async () => {
      const script = `#!/bin/bash
VAR="initial"
(VAR="sub1"; echo "subshell1: $VAR")
(VAR="sub2"; echo "subshell2: $VAR")
echo "main: $VAR"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('subshell1: sub1');
      expect(result).toContain('subshell2: sub2');
      expect(result).toContain('main: initial');
    }, 30000);
  });

  describe('サブシェルとコマンドグループ', () => {
    it('サブシェル () と コマンドグループ {} の違い', async () => {
      const script = `#!/bin/bash
VAR="original"
(VAR="in_subshell"; echo "subshell: $VAR")
echo "after subshell: $VAR"
{ VAR="in_group"; echo "group: $VAR"; }
echo "after group: $VAR"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('subshell: in_subshell');
      expect(result).toContain('after subshell: original');
      expect(result).toContain('group: in_group');
      expect(result).toContain('after group: in_group');
    }, 30000);

    it('サブシェルでリダイレクトをまとめて適用できる', async () => {
      const script = `#!/bin/bash
(
  echo "line1"
  echo "line2"
  echo "line3"
) > /tmp/subshell_output.txt
cat /tmp/subshell_output.txt | wc -l
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('3');
    }, 30000);

    it('コマンドグループでリダイレクトをまとめて適用できる', async () => {
      const script = `#!/bin/bash
{
  echo "grouped1"
  echo "grouped2"
} | grep "grouped" | wc -l
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('2');
    }, 30000);
  });

  describe('算術式展開', () => {
    it('$(( )) で算術演算ができる', async () => {
      const script = `#!/bin/bash
echo "add: \$((5 + 3))"
echo "sub: \$((10 - 4))"
echo "mul: \$((6 * 7))"
echo "div: \$((20 / 4))"
echo "mod: \$((17 % 5))"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('add: 8');
      expect(result).toContain('sub: 6');
      expect(result).toContain('mul: 42');
      expect(result).toContain('div: 5');
      expect(result).toContain('mod: 2');
    }, 30000);

    it('算術式で変数を使用できる', async () => {
      const script = `#!/bin/bash
A=10
B=20
echo "sum: \$((A + B))"
echo "product: \$((A * B))"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('sum: 30');
      expect(result).toContain('product: 200');
    }, 30000);

    it('算術式でインクリメント・デクリメント', async () => {
      const script = `#!/bin/bash
I=5
echo "pre-increment: \$((++I))"
echo "after: $I"
J=5
echo "post-increment: \$((J++))"
echo "after: $J"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('pre-increment: 6');
      expect(result).toContain('after: 6');
      expect(result).toContain('post-increment: 5');
      expect(result).toContain('after: 6');
    }, 30000);

    it('算術式でビット演算ができる', async () => {
      const script = `#!/bin/bash
echo "and: \$((12 & 10))"
echo "or: \$((12 | 10))"
echo "xor: \$((12 ^ 10))"
echo "shift: \$((5 << 2))"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('and: 8');
      expect(result).toContain('or: 14');
      expect(result).toContain('xor: 6');
      expect(result).toContain('shift: 20');
    }, 30000);

    it('算術式で比較演算ができる', async () => {
      const script = `#!/bin/bash
echo "eq: \$((5 == 5))"
echo "ne: \$((5 != 3))"
echo "lt: \$((3 < 5))"
echo "gt: \$((5 > 3))"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('eq: 1');
      expect(result).toContain('ne: 1');
      expect(result).toContain('lt: 1');
      expect(result).toContain('gt: 1');
    }, 30000);

    it('複雑な算術式', async () => {
      const script = `#!/bin/bash
echo "complex: \$(( (5 + 3) * 2 - 4 / 2 ))"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('complex: 14');
    }, 30000);
  });

  describe('サブシェルでのエラー処理', () => {
    it('サブシェル内のエラーを外で検出できる', async () => {
      const script = `#!/bin/bash
(false) || echo "subshell failed"
echo "continued"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('subshell failed');
      expect(result).toContain('continued');
    }, 30000);

    it('サブシェルの終了コードを取得できる', async () => {
      const script = `#!/bin/bash
(exit 42)
echo "subshell exit code: $?"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('subshell exit code: 42');
    }, 30000);

    it('サブシェル内で set -e が動作する', async () => {
      const script = `#!/bin/bash
(set -e; false; echo "not reached") || echo "subshell aborted"
echo "main continues"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).not.toContain('not reached');
      expect(result).toContain('subshell aborted');
      expect(result).toContain('main continues');
    }, 30000);
  });

  describe('コマンド置換とクォート', () => {
    it('コマンド置換の結果をクォートして扱える', async () => {
      const script = `#!/bin/bash
RESULT=\$(echo "  spaces  around  ")
echo "unquoted: $RESULT"
echo "quoted: \\"$RESULT\\""
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('unquoted:');
      expect(result).toContain('quoted:');
    }, 30000);

    it('改行を含むコマンド置換の結果', async () => {
      const script = `#!/bin/bash
LINES=\$(printf "line1\\nline2\\nline3")
echo "lines: $LINES"
echo "preserved:"
echo "$LINES"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('lines:');
      expect(result).toContain('preserved:');
    }, 30000);
  });

  describe('プロセス置換', () => {
    it('<() でプロセス置換を使用できる', async () => {
      const script = `#!/bin/bash
diff <(echo "content1") <(echo "content2") || echo "files differ"
`;
      const { output, errors, executionError } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('files differ');
    }, 30000);

    it('>() でプロセス置換の出力先を指定できる', async () => {
      const script = `#!/bin/bash
echo "test data" | tee >(tr 'a-z' 'A-Z' > /tmp/upper.txt) > /tmp/lower.txt
cat /tmp/upper.txt
cat /tmp/lower.txt
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('TEST DATA');
      expect(result).toContain('test data');
    }, 30000);

    it('複数のプロセス置換を同時に使用できる', async () => {
      const script = `#!/bin/bash
paste <(seq 1 3) <(seq 4 6) <(seq 7 9)
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('1');
      expect(result).toContain('4');
      expect(result).toContain('7');
    }, 30000);
  });

  describe('バックグラウンドサブシェル', () => {
    it('サブシェルをバックグラウンドで実行できる', async () => {
      const script = `#!/bin/bash
(sleep 0.1; echo "background done") &
echo "main continues"
wait
echo "all done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('main continues');
      expect(result).toContain('background done');
      expect(result).toContain('all done');
    }, 30000);

    it('複数のサブシェルを並行実行できる', async () => {
      const script = `#!/bin/bash
(echo "job1") &
(echo "job2") &
(echo "job3") &
wait
echo "all jobs done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('job');
      expect(result).toContain('all jobs done');
    }, 30000);
  });
});
