import { describe, expect, it } from 'vitest';
import { highlightCode } from '@/components/Tab/inlineCodeHighlighter';

describe('highlightCode', () => {
  it('escapes code before adding syntax spans', () => {
    const highlighted = highlightCode('const value = "<tag>";', 'typescript', true);

    expect(highlighted).toContain('&lt;tag&gt;');
    expect(highlighted).not.toContain('<tag>');
  });

  it('preserves nested shell command substitutions inside quoted strings', () => {
    const highlighted = highlightCode("echo \"$(printf '%s' 'a')\"", 'bash', true);

    expect(highlighted).toContain('$(printf');
    expect(highlighted).toContain("'%s' 'a'");
    expect(highlighted).toContain('</span>');
  });
});
