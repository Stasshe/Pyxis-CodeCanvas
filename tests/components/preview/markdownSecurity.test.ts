import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkMath from 'remark-math';
import { describe, expect, it } from 'vitest';

describe('Markdown preview HTML handling', () => {
  it('removes executable raw HTML while preserving rendered math', () => {
    const html = renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        { remarkPlugins: [remarkMath], rehypePlugins: [rehypeRaw, rehypeSanitize, rehypeKatex] },
        '<iframe srcdoc="<script>steal()</script>"></iframe><img src="x" onerror="steal()">\n\n$\\frac{1}{2}$'
      )
    );

    expect(html).not.toMatch(/<iframe|<script|onerror=/i);
    expect(html).toContain('class="katex"');
  });
});
