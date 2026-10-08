import { describe, expect, it } from 'vitest';
import { preprocessMarkdownMath } from '@/components/Tab/markdownMath';

describe('preprocessMarkdownMath', () => {
  it('converts bracket math and escapes dollar math in bracket mode', () => {
    const source = String.raw`Dollar $x$ and \(a+b\).

\[
x^2
\]`;

    expect(preprocessMarkdownMath(source, 'bracket')).toBe(
      String.raw`Dollar \$x\$ and $a+b$.

$$
x^2
$$`
    );
  });

  it('converts bracket math and leaves dollar math enabled in both mode', () => {
    const source = String.raw`Dollar $x$ and \(a+b\).

\[
x^2
\]`;

    expect(preprocessMarkdownMath(source, 'both')).toBe(
      `Dollar $x$ and $a+b$.

$$
x^2
$$`
    );
  });

  it('preserves inline code spans with matching backtick run lengths', () => {
    const source = [
      'Inline ',
      '`',
      '\\(one\\)',
      '` and ',
      '``',
      'inner ` tick \\(two\\)',
      '`` then \\(math\\)',
    ].join('');

    expect(preprocessMarkdownMath(source, 'both')).toBe(source.replace('\\(math\\)', '$math$'));
  });

  it('preserves tilde, longer, nested, and unclosed fenced code blocks', () => {
    const source = [
      '~~~text',
      '\\(tilde\\)',
      '~~~',
      '',
      '````text',
      '```js',
      'const nested = true;',
      '```',
      '\\(four-backtick\\)',
      '````',
      '',
      '~~~~~text',
      '\\[unclosed\\]',
    ].join('\n');

    expect(preprocessMarkdownMath(source, 'both')).toBe(source);
  });

  it('leaves dollar mode unchanged', () => {
    const source = String.raw`\(a+b\)`;
    expect(preprocessMarkdownMath(source, 'dollar')).toBe(source);
  });

  it('does not alter code spans containing dollar signs or placeholder-like text', () => {
    const code = [
      '`',
      '__PYXIS_ESCAPED_DOUBLE_DOLLAR__ __PYXIS_ESCAPED_SINGLE_DOLLAR__ $inside$',
      '`',
    ].join('');
    const source = `${code} Outside $literal$`;

    expect(preprocessMarkdownMath(source, 'bracket')).toBe(`${code} Outside \\$literal\\$`);
  });
});
