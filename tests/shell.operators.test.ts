/**
 * Tests for shell operators (&&, ||) and special files (/dev/null)
 */

import parseCommandLine from '@/engine/cmd/shell/parser';
import { isDevNull, isSpecialFile } from '@/engine/cmd/shell/types';

describe('Shell parser - logical operators', () => {
  test('&& operator creates segment with logicalOp', () => {
    const segs = parseCommandLine('echo hello && echo world');
    expect(segs.length).toBe(2);
    expect((segs[0] as any).logicalOp).toBe('&&');
    expect(segs[0].tokens.map((t: any) => t.text).join(' ')).toContain('echo');
    expect(segs[1].tokens.map((t: any) => t.text).join(' ')).toContain('world');
  });

  test('|| operator creates segment with logicalOp', () => {
    const segs = parseCommandLine('false || echo fallback');
    expect(segs.length).toBe(2);
    expect((segs[0] as any).logicalOp).toBe('||');
    expect(segs[1].tokens.map((t: any) => t.text).join(' ')).toContain('fallback');
  });

  test('combined && and || operators', () => {
    const segs = parseCommandLine('cmd1 && cmd2 || cmd3');
    expect(segs.length).toBe(3);
    expect((segs[0] as any).logicalOp).toBe('&&');
    expect((segs[1] as any).logicalOp).toBe('||');
    expect((segs[2] as any).logicalOp).toBeUndefined();
  });

  test('chained && operators', () => {
    const segs = parseCommandLine('a && b && c && d');
    expect(segs.length).toBe(4);
    expect((segs[0] as any).logicalOp).toBe('&&');
    expect((segs[1] as any).logicalOp).toBe('&&');
    expect((segs[2] as any).logicalOp).toBe('&&');
    expect((segs[3] as any).logicalOp).toBeUndefined();
  });
});

describe('Shell parser - /dev/null redirection', () => {
  test('redirect stdout to /dev/null', () => {
    const segs = parseCommandLine('echo test > /dev/null');
    expect(segs.length).toBeGreaterThan(0);
    const seg = segs[0] as any;
    // Could be in stdoutFile or fdFiles
    const hasDevNull = seg.stdoutFile === '/dev/null' || 
                      (seg.fdFiles && seg.fdFiles[1]?.path === '/dev/null');
    expect(hasDevNull).toBe(true);
  });

  test('redirect stderr to /dev/null', () => {
    const segs = parseCommandLine('cmd 2>/dev/null');
    expect(segs.length).toBeGreaterThan(0);
    const seg = segs[0] as any;
    const hasDevNull = seg.stderrFile === '/dev/null' || 
                      (seg.fdFiles && seg.fdFiles[2]?.path === '/dev/null');
    expect(hasDevNull).toBe(true);
  });

  test('redirect both stdout and stderr to /dev/null', () => {
    const segs = parseCommandLine('cmd > /dev/null 2>&1');
    expect(segs.length).toBeGreaterThan(0);
    const seg = segs[0] as any;
    // Check either stdoutFile or fdFiles
    const stdoutRedirected = seg.stdoutFile === '/dev/null' || 
                            (seg.fdFiles && seg.fdFiles[1]?.path === '/dev/null');
    expect(stdoutRedirected).toBe(true);
    expect(seg.stderrToStdout).toBe(true);
  });
});

describe('Special file detection helpers', () => {
  test('isDevNull identifies /dev/null correctly', () => {
    expect(isDevNull('/dev/null')).toBe(true);
    expect(isDevNull('dev/null')).toBe(true);  // normalized
    expect(isDevNull('/tmp/file')).toBe(false);
    expect(isDevNull(null)).toBe(false);
    expect(isDevNull(undefined)).toBe(false);
  });

  test('isSpecialFile identifies special files', () => {
    expect(isSpecialFile('/dev/null')).toBe(true);
    expect(isSpecialFile('/dev/zero')).toBe(true);
    expect(isSpecialFile('/dev/stdin')).toBe(true);
    expect(isSpecialFile('/dev/stdout')).toBe(true);
    expect(isSpecialFile('/dev/stderr')).toBe(true);
    expect(isSpecialFile('/home/user/file')).toBe(false);
  });
});
