import { describe, expect, it } from 'vitest';
import { resolveMarkdownLink } from '@/components/Tab/MarkdownPreview/markdownLink';

describe('resolveMarkdownLink', () => {
  it('allows only supported external link schemes', () => {
    expect(resolveMarkdownLink('HTTPS://example.com', '/docs/readme.md').kind).toBe('external');
    expect(resolveMarkdownLink('//example.com/page', '/docs/readme.md').kind).toBe('external');
    expect(resolveMarkdownLink('mailto:help@example.com', '/docs/readme.md').kind).toBe('external');
    expect(resolveMarkdownLink('javascript:alert(1)', '/docs/readme.md').kind).toBe('blocked');
    expect(resolveMarkdownLink('data:text/html,hello', '/docs/readme.md').kind).toBe('blocked');
  });

  it('decodes and normalizes local paths before candidate lookup', () => {
    expect(
      resolveMarkdownLink('../images/My%20Image.png?size=2#top', '/docs/guide/readme.md')
    ).toEqual({ kind: 'local', paths: ['/docs/images/My Image.png', '/images/My Image.png'] });
  });

  it('rejects malformed local URL encoding', () => {
    expect(resolveMarkdownLink('bad%2', '/docs/readme.md').kind).toBe('invalid');
  });
});
