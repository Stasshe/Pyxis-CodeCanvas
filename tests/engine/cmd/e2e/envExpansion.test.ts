import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestProject } from '../../../_helpers/testProject';
import { fileRepository } from '@/engine/core/fileRepository';
import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';

/**
 * 環境変数とパラメータ展開のe2eテスト
 *
 * エッジケース：
 * - 複雑なパラメータ展開構文
 * - ネストした変数展開
 * - 配列とインデックスアクセス
 * - 文字列操作
 * - パターンマッチングと置換
 */

describe('e2e — 環境変数とパラメータ展開実行テスト', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('EnvVarE2ETest');
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

  describe('基本的なパラメータ展開', () => {
    it('デフォルト値の設定 ${var:-default}', async () => {
      const script = `#!/bin/bash
unset MY_VAR
echo "default: \${MY_VAR:-fallback}"
MY_VAR="set"
echo "set: \${MY_VAR:-fallback}"
MY_VAR=""
echo "empty: \${MY_VAR:-fallback}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('default: fallback');
      expect(result).toContain('set: set');
      expect(result).toContain('empty: fallback');
    }, 30000);

    it('デフォルト値の代入 ${var:=default}', async () => {
      const script = `#!/bin/bash
unset MY_VAR
echo "before: \${MY_VAR:=assigned}"
echo "after: $MY_VAR"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('before: assigned');
      expect(result).toContain('after: assigned');
    }, 30000);

    it('変数の存在チェック ${var+set}', async () => {
      const script = `#!/bin/bash
unset UNSET_VAR
EMPTY_VAR=""
SET_VAR="value"
echo "unset: \${UNSET_VAR+is set}"
echo "empty: \${EMPTY_VAR+is set}"
echo "set: \${SET_VAR+is set}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('unset:');
      expect(result).toContain('empty: is set');
      expect(result).toContain('set: is set');
    }, 30000);

    it('変数の代替値 ${var:+alternate}', async () => {
      const script = `#!/bin/bash
unset UNSET_VAR
EMPTY_VAR=""
SET_VAR="original"
echo "unset: \${UNSET_VAR:+alternate}"
echo "empty: \${EMPTY_VAR:+alternate}"
echo "set: \${SET_VAR:+alternate}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('unset:');
      expect(result).toContain('empty:');
      expect(result).toContain('set: alternate');
    }, 30000);
  });

  describe('文字列の長さと部分文字列', () => {
    it('文字列の長さを取得 ${#var}', async () => {
      const script = `#!/bin/bash
STR="hello world"
echo "length: \${#STR}"
EMPTY=""
echo "empty length: \${#EMPTY}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('length: 11');
      expect(result).toContain('empty length: 0');
    }, 30000);

    it('部分文字列の抽出 ${var:offset:length}', async () => {
      const script = `#!/bin/bash
STR="hello world"
echo "substring1: \${STR:0:5}"
echo "substring2: \${STR:6}"
echo "substring3: \${STR:6:5}"
echo "negative: \${STR: -5}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('substring1: hello');
      expect(result).toContain('substring2: world');
      expect(result).toContain('substring3: world');
      expect(result).toContain('negative: world');
    }, 30000);

    it('負のインデックスでの部分文字列抽出', async () => {
      const script = `#!/bin/bash
STR="0123456789"
echo "from end: \${STR: -3}"
echo "range from end: \${STR: -5:3}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('from end: 789');
      expect(result).toContain('range from end: 567');
    }, 30000);
  });

  describe('パターンマッチングと削除', () => {
    it('前方最短マッチ削除 ${var#pattern}', async () => {
      const script = `#!/bin/bash
PATH_STR="/usr/local/bin/command"
echo "short: \${PATH_STR#*/}"
echo "long: \${PATH_STR##*/}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('short: usr/local/bin/command');
      expect(result).toContain('long: command');
    }, 30000);

    it('後方最短マッチ削除 ${var%pattern}', async () => {
      const script = `#!/bin/bash
FILE="document.txt.bak"
echo "short: \${FILE%.*}"
echo "long: \${FILE%%.*}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('short: document.txt');
      expect(result).toContain('long: document');
    }, 30000);

    it('複雑なパターンマッチング', async () => {
      const script = `#!/bin/bash
URL="https://example.com/path/to/file.html"
echo "protocol: \${URL%%://*}"
echo "domain: \${URL#*://}"
echo "domain only: \${URL#*://}"
echo "path: /\${URL#*://*/}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('protocol: https');
      expect(result).toContain('domain: example.com/path/to/file.html');
    }, 30000);
  });

  describe('パターン置換', () => {
    it('最初のマッチを置換 ${var/pattern/replacement}', async () => {
      const script = `#!/bin/bash
STR="apple apple apple"
echo "first: \${STR/apple/orange}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('first: orange apple apple');
    }, 30000);

    it('全てのマッチを置換 ${var//pattern/replacement}', async () => {
      const script = `#!/bin/bash
STR="apple apple apple"
echo "all: \${STR//apple/orange}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('all: orange orange orange');
    }, 30000);

    it('前方マッチ置換 ${var/#pattern/replacement}', async () => {
      const script = `#!/bin/bash
STR="hello world hello"
echo "prefix: \${STR/#hello/hi}"
STR2="world hello"
echo "no prefix: \${STR2/#hello/hi}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('prefix: hi world hello');
      expect(result).toContain('no prefix: world hello');
    }, 30000);

    it('後方マッチ置換 ${var/%pattern/replacement}', async () => {
      const script = `#!/bin/bash
STR="test.txt"
echo "suffix: \${STR/%.txt/.md}"
STR2="test.txt.bak"
echo "no suffix: \${STR2/%.txt/.md}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('suffix: test.md');
      expect(result).toContain('no suffix: test.txt.bak');
    }, 30000);

    it('パターン削除（空文字列への置換）', async () => {
      const script = `#!/bin/bash
STR="a1b2c3d4"
echo "remove digits: \${STR//[0-9]/}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('remove digits: abcd');
    }, 30000);
  });

  describe('大文字小文字変換', () => {
    it('最初の文字を大文字に ${var^}', async () => {
      const script = `#!/bin/bash
STR="hello world"
echo "first upper: \${STR^}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('first upper: Hello world');
    }, 30000);

    it('全ての文字を大文字に ${var^^}', async () => {
      const script = `#!/bin/bash
STR="hello world"
echo "all upper: \${STR^^}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('all upper: HELLO WORLD');
    }, 30000);

    it('最初の文字を小文字に ${var,}', async () => {
      const script = `#!/bin/bash
STR="HELLO WORLD"
echo "first lower: \${STR,}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('first lower: hELLO WORLD');
    }, 30000);

    it('全ての文字を小文字に ${var,,}', async () => {
      const script = `#!/bin/bash
STR="HELLO WORLD"
echo "all lower: \${STR,,}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('all lower: hello world');
    }, 30000);
  });

  describe('配列変数', () => {
    it('配列の要素にアクセスできる', async () => {
      const script = `#!/bin/bash
ARR=("apple" "banana" "cherry")
echo "first: \${ARR[0]}"
echo "second: \${ARR[1]}"
echo "third: \${ARR[2]}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('first: apple');
      expect(result).toContain('second: banana');
      expect(result).toContain('third: cherry');
    }, 30000);

    it('配列の全要素を展開できる', async () => {
      const script = `#!/bin/bash
ARR=("one" "two" "three")
echo "all: \${ARR[@]}"
echo "all quoted: "\${ARR[@]}""
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('all: one two three');
    }, 30000);

    it('配列の長さを取得できる', async () => {
      const script = `#!/bin/bash
ARR=("a" "b" "c" "d" "e")
echo "length: \${#ARR[@]}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('length: 5');
    }, 30000);

    it('配列のスライスを取得できる', async () => {
      const script = `#!/bin/bash
ARR=("a" "b" "c" "d" "e")
echo "slice: \${ARR[@]:1:3}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('slice: b c d');
    }, 30000);

    it('配列の要素に対してパターン置換ができる', async () => {
      const script = `#!/bin/bash
ARR=("file1.txt" "file2.txt" "file3.txt")
echo "replaced: \${ARR[@]/.txt/.md}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('replaced: file1.md file2.md file3.md');
    }, 30000);
  });

  describe('間接展開', () => {
    it('変数名を動的に参照できる ${!var}', async () => {
      const script = `#!/bin/bash
VAR_NAME="MY_VAR"
MY_VAR="value"
echo "indirect: \${!VAR_NAME}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('indirect: value');
    }, 30000);

    it('プレフィックスマッチで変数名を列挙できる ${!prefix*}', async () => {
      const script = `#!/bin/bash
MY_VAR1="a"
MY_VAR2="b"
MY_VAR3="c"
echo "vars: \${!MY_VAR@}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('vars:');
      expect(result).toContain('MY_VAR');
    }, 30000);
  });

  describe('ネストした展開', () => {
    it('展開の中で展開を使用できる', async () => {
      const script = `#!/bin/bash
PREFIX="test"
SUFFIX="file"
COMBINED="\${PREFIX}_\${SUFFIX}"
echo "combined: $COMBINED"
echo "length: \${#COMBINED}"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('combined: test_file');
      expect(result).toContain('length: 9');
    }, 30000);

    it('複雑なネスト展開', async () => {
      const script = `#!/bin/bash
BASE="value"
VAR1="\${BASE}_1"
VAR2="\${VAR1}_2"
echo "nested: $VAR2"
`;
      const { output, errors, executionError } = await executeScript(script);

      assertNoErrors(output, errors, executionError);

      const result = output.join('\n');
      expect(result).toContain('nested:');
    }, 30000);
  });
});
