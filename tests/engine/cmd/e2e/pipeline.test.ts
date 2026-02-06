import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestProject } from '../../../_helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';

/**
 * 複雑なパイプラインコマンドのe2eテスト
 *
 * エッジケース：
 * - 複数のパイプ連鎖
 * - パイプとリダイレクトの組み合わせ
 * - stderr/stdoutの複雑なリダイレクト
 * - パイプ途中でのエラー伝播
 */

describe('e2e — 複雑なパイプラインコマンド実行テスト', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('PipelineE2ETest');
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

    // 厳密なエラーチェック
    expect(allOutput).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(allOutput).not.toContain('Cannot find module');
    expect(allOutput).not.toContain('Module execution failed');
    expect(allOutput).not.toContain('SyntaxError');
    expect(allOutput).not.toContain('ReferenceError');
    expect(allOutput).not.toContain('TypeError');
    expect(allOutput).not.toContain('ENOENT');
    expect(allOutput).not.toContain('EACCES');
    expect(allOutput).not.toContain('command not found');
    expect(allOutput).not.toMatch(/ERROR:/i);
    expect(allOutput).not.toMatch(/\[ERROR\]/i);
    expect(allOutput).not.toMatch(/fatal/i);

    if (executionError) {
      throw new Error(
        `Execution failed: ${executionError.message}\nStack: ${executionError.stack}`
      );
    }

    if (errors.length > 0) {
      throw new Error(`Errors detected:\n${errors.join('\n')}`);
    }
  }

  describe('複数パイプ連鎖', () => {
    it('3つ以上のコマンドをパイプで連結して正しく実行できる', async () => {
      const script = `#!/bin/bash
echo "apple
banana
cherry
date
elderberry" | grep "e" | sort -r | head -n 2
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      // 結果の検証: "e" を含む行を逆順ソートして上位2件
      const result = output.join('\n');
      expect(result).toContain('elderberry');
      expect(result).toContain('date');
    }, 30000);

    it('5段階のパイプライン処理が正しく動作する', async () => {
      const script = `#!/bin/bash
seq 1 100 | awk '{print $1 * 2}' | grep "0$" | sort -rn | head -n 5 | tail -n 1
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      // 1-100を2倍して、末尾が0のもの、逆順ソート、上位5件の最後 = 160
      const result = output.join('\n').trim();
      expect(result).toBe('160');
    }, 30000);

    it('パイプとxargsの組み合わせで複雑な処理を実行できる', async () => {
      const script = `#!/bin/bash
echo "file1.txt file2.txt file3.txt" | tr ' ' '\\n' | xargs -I {} echo "Processing: {}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('Processing: file1.txt');
      expect(result).toContain('Processing: file2.txt');
      expect(result).toContain('Processing: file3.txt');
    }, 30000);
  });

  describe('複雑なリダイレクト', () => {
    it('stdout と stderr を別々にリダイレクトできる', async () => {
      const script = `#!/bin/bash
echo "stdout message" > /tmp/out.txt
echo "stderr message" >&2 2> /tmp/err.txt
cat /tmp/out.txt
cat /tmp/err.txt
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('stdout message');
    }, 30000);

    it('stdout と stderr をマージして処理できる', async () => {
      const script = `#!/bin/bash
(echo "line1"; echo "line2" >&2; echo "line3") 2>&1 | sort
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('line1');
      expect(result).toContain('line2');
      expect(result).toContain('line3');
    }, 30000);

    it('here-document をパイプに渡して処理できる', async () => {
      const script = `#!/bin/bash
cat <<EOF | grep "important" | tr '[:lower:]' '[:upper:]'
this is important
this is not
very important line
EOF
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('IMPORTANT');
    }, 30000);

    it('複数のリダイレクトを組み合わせて使用できる', async () => {
      const script = `#!/bin/bash
{
  echo "output line 1"
  echo "output line 2"
  echo "error line 1" >&2
} > /tmp/combined.txt 2>&1
cat /tmp/combined.txt | wc -l
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n').trim();
      // 3行あるはず
      expect(result).toContain('3');
    }, 30000);
  });

  describe('パイプエラー伝播', () => {
    it('パイプの途中でエラーが発生しても後続コマンドが実行される（デフォルト動作）', async () => {
      const script = `#!/bin/bash
echo "test" | grep "nonexistent" | echo "still running"
echo "final"
`;
      const { output, errors, executionError } = await executeScript(script);

      // エラーが発生しても実行は継続される
      const result = output.join('\n');
      expect(result).toContain('still running');
      expect(result).toContain('final');
    }, 30000);

    it('set -o pipefail でパイプエラーを検出できる', async () => {
      const script = `#!/bin/bash
set -o pipefail
(echo "test" | grep "nonexistent" | echo "this runs") || echo "pipeline failed"
echo "continued"
`;
      const { output, errors, executionError } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('pipeline failed');
      expect(result).toContain('continued');
    }, 30000);

    it('パイプ途中の false コマンドの終了コードを確認できる', async () => {
      const script = `#!/bin/bash
echo "test" | false | echo "after false"
echo "Exit code: $?"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('after false');
      expect(result).toContain('Exit code:');
    }, 30000);
  });

  describe('プロセス置換', () => {
    it('プロセス置換を使って複数の入力を処理できる', async () => {
      const script = `#!/bin/bash
diff <(echo "lineA") <(echo "lineB") || echo "files differ"
`;
      const { output, errors, executionError } = await executeScript(script);

      const result = output.join('\n');
      expect(result).toContain('files differ');
    }, 30000);

    it('プロセス置換と通常のパイプを組み合わせて使用できる', async () => {
      const script = `#!/bin/bash
echo "test123" | tee >(tr '[:lower:]' '[:upper:]' > /tmp/upper.txt) | wc -c
cat /tmp/upper.txt
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('TEST123');
    }, 30000);
  });

  describe('バックグラウンドジョブとパイプ', () => {
    it('バックグラウンドジョブの出力をパイプで処理できる', async () => {
      const script = `#!/bin/bash
(sleep 0.1; echo "background output") | cat &
wait
echo "done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('background output');
      expect(result).toContain('done');
    }, 30000);

    it('複数のバックグラウンドパイプラインを並行実行できる', async () => {
      const script = `#!/bin/bash
(echo "job1" | tr 'a-z' 'A-Z') &
(echo "job2" | tr 'a-z' 'A-Z') &
wait
echo "all done"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('JOB');
      expect(result).toContain('all done');
    }, 30000);
  });

  describe('名前付きパイプ（FIFO）', () => {
    it('mkfifo で作成した名前付きパイプを使用できる', async () => {
      const script = `#!/bin/bash
FIFO="/tmp/test_fifo_$$"
mkfifo "$FIFO"
echo "data via fifo" > "$FIFO" &
cat "$FIFO"
rm -f "$FIFO"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('data via fifo');
    }, 30000);
  });
});
