import { beforeEach, describe, expect, it } from 'vitest';
import { TrCommand } from '@/engine/system/commands/unix/tr';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

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
  let rootPath: string;
  let testFs: Awaited<ReturnType<typeof setupTestProject>>['repo'];
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const ctx = await setupTestProject('PipelineE2ETest');
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
    executionError: Error | null;
  }> {
    await testFs.writeFile(`${rootPath}/${scriptName}`, scriptContent);
    const result = await shell!.run(`bash ${scriptName}`);
    return {
      output: result.stdout.split('\n').filter(Boolean),
      errors: result.stderr.split('\n').filter(Boolean),
      executionError:
        result.code !== 0
          ? new Error(`Script exited with code ${result.code}\n${result.stderr}`)
          : null,
    };
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

  describe('stdin commands', () => {
    it('passes piped stdin through cat', async () => {
      const result = await shell!.run('printf stdin | cat');

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toBe('stdin');
    });

    it('maps character classes and ranges with tr', async () => {
      const classes = await shell!.run("printf 'az by' | tr '[:lower:]' '[:upper:]'");
      const ranges = await shell!.run("printf 'abc xyz' | tr 'a-z' 'A-Z'");

      expect(classes.code, classes.stderr).toBe(0);
      expect(classes.stdout).toBe('AZ BY');
      expect(ranges.code, ranges.stderr).toBe(0);
      expect(ranges.stdout).toBe('ABC XYZ');
      const backslashEscape = new TrCommand(rootPath, rootPath).execute(
        ['\\n', ' '],
        'left\nright'
      );
      expect(backslashEscape).toBe('left right');
    });

    it('parses quoted xargs words and substitutes each input line', async () => {
      const quoted = await shell!.run(`printf "'first item' second" | xargs echo`);
      const replaced = await shell!.run(
        `printf 'first item\\nsecond item\\n' | xargs -I {} echo 'Processing: {}'`
      );

      expect(quoted.code, quoted.stderr).toBe(0);
      expect(quoted.stdout).toBe('first item second\n');
      expect(replaced.code, replaced.stderr).toBe(0);
      expect(replaced.stdout).toBe('Processing: first item\nProcessing: second item\n');
    });

    it('copies binary stdin through tee and reports file errors after forwarding it', async () => {
      const bytes = new Uint8Array([0, 255, 65, 10]);
      await testFs.writeFile(`${rootPath}/input.bin`, bytes);
      const copied = await shell!.run('cat input.bin | tee copy.bin > /dev/null');
      const copyBytes = await testFs.readFile(`${rootPath}/copy.bin`);
      const unix = terminalCommandRegistry.getUnixCommands(rootPath);
      const appended = await unix.tee(['-a', 'copy.bin'], new Uint8Array([255]));
      const appendedBytes = await testFs.readFile(`${rootPath}/copy.bin`);
      const failed = await shell!.run('printf data | tee missing/output.bin');

      expect(copied.code, copied.stderr).toBe(0);
      expect([...copyBytes]).toEqual([...bytes]);
      expect([...appended.output]).toEqual([255]);
      expect([...appendedBytes]).toEqual([0, 255, 65, 10, 255]);
      expect(failed.code).not.toBe(0);
      expect(failed.stdout).toBe('data');
      expect(failed.stderr).toContain('tee: missing/output.bin');
    });

    it('preserves binary bytes in numbered cat and wc byte counts', async () => {
      const bytes = new Uint8Array([255, 120, 10]);
      await testFs.writeFile(`${rootPath}/input.bin`, bytes);

      const numbered = await shell!.run('cat -n input.bin > numbered.bin');
      const visible = await shell!.run('cat -v input.bin > visible.txt');
      const counted = await shell!.run('wc -c input.bin');
      const characters = await shell!.run('wc -m input.bin');
      const combinedCounts = await shell!.run('wc -lw input.bin');
      const byteAndCharacterCounts = await shell!.run('wc -cm input.bin');
      const repeatedStdin = await shell!.run('printf x | wc -c - -');
      const numberedBytes = await testFs.readFile(`${rootPath}/numbered.bin`);
      const visibleText = await testFs.readText(`${rootPath}/visible.txt`);

      expect(numbered.code, numbered.stderr).toBe(0);
      expect([...numberedBytes]).toEqual([32, 32, 32, 32, 32, 49, 9, 255, 120, 10]);
      expect(visible.code, visible.stderr).toBe(0);
      expect(visibleText).toBe('M-^?x\n');
      expect(counted.stdout).toBe('3 input.bin\n');
      expect(characters.stdout).toBe('2 input.bin\n');
      expect(combinedCounts.stdout).toBe('1 1 input.bin\n');
      expect(byteAndCharacterCounts.stdout).toBe('2 3 input.bin\n');
      expect(repeatedStdin.stdout).toBe('1 -\n0 -\n1 total\n');

      await testFs.writeFile(`${rootPath}/invalid-utf8.bin`, new Uint8Array([255, 255]));
      const invalidCharacterCount = await shell!.run('wc -m invalid-utf8.bin');
      const invalidWordCount = await shell!.run('wc -w invalid-utf8.bin');
      expect(invalidCharacterCount.stdout).toBe('0 invalid-utf8.bin\n');
      expect(invalidWordCount.stdout).toBe('1 invalid-utf8.bin\n');
    });

    it('preserves invalid UTF-8 bytes when head and tail select lines', async () => {
      await testFs.writeFile(`${rootPath}/line-bytes.bin`, new Uint8Array([255, 10, 254, 10]));

      const head = await shell!.run('head -n 1 line-bytes.bin > head-line.bin');
      const tail = await shell!.run('tail -n 1 line-bytes.bin > tail-line.bin');

      expect(head.code, head.stderr).toBe(0);
      expect(tail.code, tail.stderr).toBe(0);
      expect([...(await testFs.readFile(`${rootPath}/head-line.bin`))]).toEqual([255, 10]);
      expect([...(await testFs.readFile(`${rootPath}/tail-line.bin`))]).toEqual([254, 10]);
    });

    it('treats CR as content when cat squeezes or numbers blank-looking records', async () => {
      const squeezed = await shell!.run("printf '\\r\\n\\r\\n' | cat -s > squeezed.bin");
      const numbered = await shell!.run("printf '\\r\\n' | cat -b > numbered-cr.bin");

      expect(squeezed.code, squeezed.stderr).toBe(0);
      expect([...(await testFs.readFile(`${rootPath}/squeezed.bin`))]).toEqual([13, 10, 13, 10]);
      expect(numbered.code, numbered.stderr).toBe(0);
      expect([...(await testFs.readFile(`${rootPath}/numbered-cr.bin`))]).toEqual([
        32, 32, 32, 32, 32, 49, 9, 13, 10,
      ]);
    });

    it('rejects unknown tee options and honors the option terminator', async () => {
      const invalid = await shell!.run('printf data | tee -x');
      const literalFile = await shell!.run('printf data | tee -- -literal-name > /dev/null');

      expect(invalid.code).not.toBe(0);
      expect(invalid.stderr).toContain('tee: invalid option');
      expect(await testFs.exists(`${rootPath}/-x`)).toBe(false);
      expect(literalFile.code, literalFile.stderr).toBe(0);
      expect(await testFs.readText(`${rootPath}/-literal-name`)).toBe('data');
    });
  });

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

      expect(executionError).toBeNull();
      expect(output).toEqual(['stdout message']);
      expect(errors).toEqual(['stderr message']);
      expect(new TextDecoder().decode(await testFs.readFile('/tmp/err.txt'))).toBe('');
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

      assertNoErrors(output, errors, executionError);
      // エラーが発生しても実行は継続される
      expect(output).toEqual(['still running', 'final']);
    }, 30000);

    it('set -o pipefail でパイプエラーを検出できる', async () => {
      const script = `#!/bin/bash
set -o pipefail
(echo "test" | grep "nonexistent" | echo "this runs") || echo "pipeline failed"
echo "continued"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);
      expect(output).toEqual(['this runs', 'pipeline failed', 'continued']);
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
    it('複数の入力プロセス置換を cat で読み取れる', async () => {
      const script = `#!/bin/bash
cat <(seq 1 2) <(seq 3 4)
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);
      expect(output).toEqual(['1', '2', '3', '4']);
    }, 30000);

    it('プロセス置換と通常のパイプを組み合わせて使用できる', async () => {
      const script = `#!/bin/bash
echo "test123" | tee >(tr '[:lower:]' '[:upper:]' > /tmp/upper.txt) | wc -c
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      expect(output).toEqual(['8']);
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

  describe('process substitution', () => {
    it('delivers EOF to an output substitution after its parent writer drains', async () => {
      const result = await shell!.run("printf 'payload' > >(cat > captured.txt); wait $!");

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toBe('');
      expect(await testFs.readText(`${rootPath}/captured.txt`)).toBe('payload');
    });

    it('runs an unused process substitution and waits by its process ID', async () => {
      const result = await shell!.run('echo <(exit 7); wait $!');

      expect(result.stdout).toMatch(/\/dev\/fd\/\d+/);
      expect(result.code, result.stderr).toBe(7);
    }, 30000);

    it('keeps unconsumed process substitution side effects', async () => {
      const result = await shell!.run('echo <(echo side-effect >&2); wait $!');

      expect(result.stderr).toContain('side-effect');
      expect(result.code, result.stderr).toBe(0);
    }, 30000);

    it('preserves a process substitution while its consumer reads it', async () => {
      const result = await shell!.run("cat <(printf 'payload'; exit 7); wait $!");

      expect(result.stdout).toContain('payload');
      expect(result.code, result.stderr).toBe(7);
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

      expect(output).toEqual(['data via fifo']);
    }, 30000);
  });
});
