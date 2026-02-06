import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  createFile,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell script variable edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('ScriptVarTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  const runScript = async (script: string, args: string[] = []) => {
    await createFile(ctx.projectId, '/test.sh', script);
    const cmd = args.length > 0 ? `sh /test.sh ${args.join(' ')}` : 'sh /test.sh';
    return ctx.shell.run(cmd);
  };

  describe('basic assignment and echo', () => {
    it('simple assignment', async () => {
      const r = await runScript('x=hello\necho $x');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello');
    });

    it('assignment with double-quoted value', async () => {
      const r = await runScript('msg="hello world"\necho $msg');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello world');
    });

    it('assignment with single-quoted value preserves literal', async () => {
      const r = await runScript("msg='literal $var'\necho $msg");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('literal $var');
    });

    it('variable reassignment overwrites', async () => {
      const r = await runScript('x=first\nx=second\necho $x');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('second');
      expect(r.stdout).not.toContain('first');
    });
  });

  describe('arithmetic in assignments', () => {
    it('arithmetic expression in assignment', async () => {
      const r = await runScript('x=$((3 + 4))\necho $x');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('7');
    });

    it('variable used in arithmetic', async () => {
      const r = await runScript('a=10\nb=20\nc=$((a + b))\necho $c');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('30');
    });

    it('arithmetic increment pattern', async () => {
      const r = await runScript('x=0\nx=$((x + 1))\nx=$((x + 1))\necho $x');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('2');
    });
  });

  describe('command substitution in assignment', () => {
    it('captures command output', async () => {
      const r = await runScript('x=$(echo captured)\necho $x');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('captured');
    });

    it('captures pwd output', async () => {
      const r = await runScript('dir=$(pwd)\necho $dir');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('/');
    });
  });

  describe('positional parameters', () => {
    it('$1 gets first argument', async () => {
      const r = await runScript('echo $1', ['firstarg']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('firstarg');
    });

    it('$1 $2 $3 get respective arguments', async () => {
      const r = await runScript('echo $1 $2 $3', ['aaa', 'bbb', 'ccc']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('aaa');
      expect(r.stdout).toContain('bbb');
      expect(r.stdout).toContain('ccc');
    });

    it('$0 contains script name', async () => {
      const r = await runScript('echo $0');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('test.sh');
    });

    it('$@ expands to all arguments', async () => {
      const r = await runScript('echo "$@"', ['a', 'b', 'c']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
      expect(r.stdout).toContain('b');
      expect(r.stdout).toContain('c');
    });

    it('missing positional arg expands to empty', async () => {
      const r = await runScript('echo "[$1]"');
      expect(r.code).toBe(0);
      // $1 is empty when no args provided
      expect(r.stdout).toContain('[]');
    });
  });

  describe('variable in loop', () => {
    it('loop body can modify outer variable', async () => {
      const r = await runScript([
        'x=0',
        'for i in a b c',
        'do',
        'x=$((x + 1))',
        'done',
        'echo $x',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('3');
    });

    it('variable with spaces in quoted context', async () => {
      const r = await runScript('name="John Doe"\necho "Hello $name"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('Hello John Doe');
    });
  });
});
