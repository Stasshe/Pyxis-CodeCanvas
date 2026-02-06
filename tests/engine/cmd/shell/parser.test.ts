import { describe, it, expect } from 'vitest';
import { parseCommandLine, ParseError } from '@/engine/cmd/shell/parser';

/**
 * Shell パーサーのテスト
 * コマンドラインを Segment[] にパースする
 */

describe('parseCommandLine', () => {
  // ==================== 基本 ====================

  describe('基本的なコマンド', () => {
    it('単一コマンドをパースする', () => {
      const segs = parseCommandLine('echo hello');
      expect(segs).toHaveLength(1);
      expect(segs[0].tokens[0].text).toBe('echo');
      expect(segs[0].tokens[1].text).toBe('hello');
    });

    it('引数なしのコマンド', () => {
      const segs = parseCommandLine('ls');
      expect(segs).toHaveLength(1);
      expect(segs[0].tokens).toHaveLength(1);
      expect(segs[0].tokens[0].text).toBe('ls');
    });

    it('複数引数', () => {
      const segs = parseCommandLine('git commit -m "message"');
      expect(segs).toHaveLength(1);
      expect(segs[0].tokens[0].text).toBe('git');
      expect(segs[0].tokens[1].text).toBe('commit');
      expect(segs[0].tokens[2].text).toBe('-m');
      expect(segs[0].tokens[3].text).toBe('message');
      expect(segs[0].tokens[3].quote).toBe('double');
    });

    it('空文字列は空配列を返す', () => {
      const segs = parseCommandLine('');
      expect(segs).toHaveLength(0);
    });
  });

  // ==================== クォート ====================

  describe('クォート処理', () => {
    it('シングルクォート', () => {
      const segs = parseCommandLine("echo 'hello world'");
      expect(segs[0].tokens[1].text).toBe('hello world');
      expect(segs[0].tokens[1].quote).toBe('single');
    });

    it('ダブルクォート', () => {
      const segs = parseCommandLine('echo "hello world"');
      expect(segs[0].tokens[1].text).toBe('hello world');
      expect(segs[0].tokens[1].quote).toBe('double');
    });

    it('エスケープされたスペース', () => {
      const segs = parseCommandLine('echo hello\\ world');
      expect(segs[0].tokens[1].text).toBe('hello world');
    });

    it('空文字列のクォート', () => {
      const segs = parseCommandLine("echo ''");
      expect(segs[0].tokens[1].text).toBe('');
      expect(segs[0].tokens[1].quote).toBe('single');
    });
  });

  // ==================== パイプ ====================

  describe('パイプ', () => {
    it('パイプで2つのコマンドを接続', () => {
      const segs = parseCommandLine('ls | grep test');
      expect(segs).toHaveLength(2);
      expect(segs[0].tokens[0].text).toBe('ls');
      expect(segs[1].tokens[0].text).toBe('grep');
      expect(segs[1].tokens[1].text).toBe('test');
    });

    it('3段パイプ', () => {
      const segs = parseCommandLine('cat file | sort | uniq');
      expect(segs).toHaveLength(3);
    });
  });

  // ==================== 論理演算子 ====================

  describe('論理演算子', () => {
    it('&& で2つのコマンドを接続', () => {
      const segs = parseCommandLine('mkdir dir && cd dir');
      expect(segs.length).toBeGreaterThanOrEqual(2);
    });

    it('|| で2つのコマンドを接続', () => {
      const segs = parseCommandLine('test -f file || echo "not found"');
      expect(segs.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== リダイレクト ====================

  describe('リダイレクト', () => {
    it('stdout リダイレクト (>)', () => {
      const segs = parseCommandLine('echo hello > output.txt');
      expect(segs).toHaveLength(1);
      expect(segs[0].stdoutFile).toBe('output.txt');
    });

    it('stdout 追記 (>>)', () => {
      const segs = parseCommandLine('echo hello >> output.txt');
      expect(segs).toHaveLength(1);
      expect(segs[0].stdoutFile).toBe('output.txt');
      expect(segs[0].append).toBe(true);
    });

    it('stdin リダイレクト (<)', () => {
      const segs = parseCommandLine('sort < input.txt');
      expect(segs).toHaveLength(1);
      expect(segs[0].stdinFile).toBe('input.txt');
    });

    it('stderr を stdout に結合 (2>&1)', () => {
      const segs = parseCommandLine('command 2>&1');
      expect(segs).toHaveLength(1);
      expect(segs[0].stderrToStdout).toBe(true);
    });

    it('/dev/null へのリダイレクト', () => {
      const segs = parseCommandLine('command > /dev/null');
      expect(segs[0].stdoutFile).toBe('/dev/null');
    });
  });

  // ==================== 変数展開 ====================

  describe('変数展開', () => {
    it('$HOME を展開する', () => {
      const segs = parseCommandLine('echo $HOME', { HOME: '/home/user' });
      expect(segs[0].tokens[1].text).toBe('/home/user');
    });

    it('${VAR} 形式を展開する', () => {
      const segs = parseCommandLine('echo ${USER}', { USER: 'alice' });
      expect(segs[0].tokens[1].text).toBe('alice');
    });

    it('未定義変数は空文字になる', () => {
      const segs = parseCommandLine('echo $UNDEFINED', {});
      // Either removed or empty token
      const text = segs[0].tokens.slice(1).map(t => t.text).join('');
      expect(text).toBe('');
    });
  });

  // ==================== コマンド置換 ====================

  describe('コマンド置換', () => {
    it('$(cmd) を認識する', () => {
      const segs = parseCommandLine('echo $(whoami)', {});
      expect(segs[0].tokens.length).toBeGreaterThanOrEqual(1);
      // cmdSub should be set for the substitution token
      const subToken = segs[0].tokens.find(t => t.cmdSub);
      expect(subToken).toBeDefined();
      expect(subToken?.cmdSub).toBe('whoami');
    });

    it('バッククォートを認識する', () => {
      const segs = parseCommandLine('echo `date`', {});
      const subToken = segs[0].tokens.find(t => t.cmdSub);
      expect(subToken).toBeDefined();
      expect(subToken?.cmdSub).toBe('date');
    });
  });

  // ==================== バックグラウンド ====================

  describe('バックグラウンド実行', () => {
    it('& でバックグラウンドフラグが立つ', () => {
      const segs = parseCommandLine('sleep 10 &');
      expect(segs).toHaveLength(1);
      expect(segs[0].background).toBe(true);
    });
  });

  // ==================== エッジケース ====================

  describe('エッジケース', () => {
    it('連続するスペースを正しく処理', () => {
      const segs = parseCommandLine('echo   hello    world');
      expect(segs[0].tokens[0].text).toBe('echo');
      expect(segs[0].tokens[1].text).toBe('hello');
      expect(segs[0].tokens[2].text).toBe('world');
    });

    it('セミコロンで複数コマンド', () => {
      const segs = parseCommandLine('echo a; echo b');
      expect(segs.length).toBeGreaterThanOrEqual(2);
    });
  });
});
