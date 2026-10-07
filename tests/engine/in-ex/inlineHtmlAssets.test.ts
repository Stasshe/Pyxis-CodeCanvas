import { describe, expect, it } from 'vitest';

import { inlineHtmlAssets } from '@/engine/in-ex/inlineHtmlAssets';

describe('inlineHtmlAssets', () => {
  it('embeds local binary image bytes using the detected MIME type', async () => {
    const html = new TextEncoder().encode(
      '<html><head></head><body><img src="image.dat"></body></html>'
    );
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      ),
      character => character.charCodeAt(0)
    );
    const content = await inlineHtmlAssets(['index.html', 'image.dat'], '/site', async path => {
      if (path === '/site/index.html') return html;
      if (path === '/site/image.dat') return png;
      throw new Error(`Unexpected asset path: ${path}`);
    });

    expect(content).toContain('src="data:image/png;base64,');
  });

  it('keeps external image URLs unchanged', async () => {
    const html = new TextEncoder().encode(
      '<html><head></head><body><img src="https://example.com/image.png"></body></html>'
    );
    const content = await inlineHtmlAssets(['index.html'], '/site', async () => html);

    expect(content).toContain('src="https://example.com/image.png"');
  });

  it('inlines only referenced scripts and resolves CSS assets relative to the stylesheet', async () => {
    const html = new TextEncoder().encode(
      '<html><head><link rel="stylesheet" href="styles/site.css"></head><body><script src="scripts/app.js"></script></body></html>'
    );
    const css = new TextEncoder().encode('body { background-image: url("../images/bg.dat"); }');
    const script = new TextEncoder().encode('window.appLoaded = true;');
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      ),
      character => character.charCodeAt(0)
    );
    const content = await inlineHtmlAssets(['index.html', 'unused.js'], '/site', async path => {
      if (path === '/site/index.html') return html;
      if (path === '/site/styles/site.css') return css;
      if (path === '/site/scripts/app.js') return script;
      if (path === '/site/images/bg.dat') return png;
      if (path === '/site/unused.js') return new TextEncoder().encode('window.unused = true;');
      throw new Error(`Unexpected asset path: ${path}`);
    });

    expect(content).toContain('background-image: url("data:image/png;base64,');
    expect(content).toContain('window.appLoaded = true;');
    expect(content).not.toContain('window.unused = true;');
  });
});
