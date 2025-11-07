import { parseCommandLine } from '@/engine/cmd/shell/parser';
import { ParseError } from '@/engine/cmd/shell/parser';

describe('parser unterminated command-substitution errors', () => {
  test('unterminated backtick throws ParseError with pos', () => {
    expect(() => parseCommandLine('echo `unterminated')).toThrowError(ParseError);
    try {
      parseCommandLine('echo `unterminated');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ParseError);
      expect(e.message).toMatch(/Unterminated backtick/);
      expect(typeof e.pos).toBe('number');
    }
  });

  test('unterminated $() throws ParseError with pos', () => {
    expect(() => parseCommandLine('echo $(unterminated')).toThrowError(ParseError);
    try {
      parseCommandLine('echo $(unterminated');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ParseError);
      expect(e.message).toMatch(/Unterminated \$\(\.\.\.\)/);
      expect(typeof e.pos).toBe('number');
    }
  });
});
