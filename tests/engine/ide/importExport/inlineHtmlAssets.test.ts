import { describe, expect, it } from 'vitest';

import { inlineHtmlAssets } from '@/engine/ide/importExport/inlineHtmlAssets';

describe('inlineHtmlAssets', () => {
  it('preserves large binary assets across base64 encoding chunks', async () => {
    const html = new TextEncoder().encode('<img src="payload.bin">');
    const bytes = Uint8Array.from({ length: 40000 }, (_, index) => index % 256);
    const expectedBinary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');

    const content = await inlineHtmlAssets(['index.html', 'payload.bin'], '/site', async path => {
      if (path === '/site/index.html') return html;
      if (path === '/site/payload.bin') return bytes;
      throw new Error(`Unexpected asset path: ${path}`);
    });

    expect(content).toContain(`src="data:application/octet-stream;base64,${btoa(expectedBinary)}"`);
  });

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

  it('reports resolved local dependencies outside the preview directory', async () => {
    const html = new TextEncoder().encode(
      '<link rel="stylesheet" href="/shared/theme.css"><img src="/shared/logo.png">'
    );
    const css = new TextEncoder().encode('body { background: url("/shared/background.png"); }');
    const dependencies: string[] = [];

    await inlineHtmlAssets(
      ['index.html'],
      '/site',
      async path => {
        if (path === '/site/index.html') return html;
        if (path === '/shared/theme.css') return css;
        if (path === '/shared/logo.png' || path === '/shared/background.png') {
          return new TextEncoder().encode('image bytes');
        }
        throw new Error(`Unexpected asset path: ${path}`);
      },
      undefined,
      path => dependencies.push(path)
    );

    expect(dependencies).toEqual([
      '/site/index.html',
      '/shared/theme.css',
      '/shared/background.png',
      '/shared/logo.png',
    ]);
  });

  it('inlines only parsed resource attributes and preserves document and raw-text content', async () => {
    const html = new TextEncoder().encode(
      `<!doctype html><!-- <img src="comment.png"> --><html><head><link rel=stylesheet href=site.css media=screen data-href=metadata><script>const snippet = '<img src="inline.png">';</script><script src=app.js type=module data-src=metadata></script></head><body><img data-src="metadata.png" src=photo.png></body></html>`
    );
    const resources = new Map([
      ['/site/index.html', html],
      ['/site/site.css', new TextEncoder().encode('body::after { content: "</style>"; }')],
      [
        '/site/app.js',
        new TextEncoder().encode(`const close = '</script>'; window.loaded = true;`),
      ],
      ['/site/photo.png', new TextEncoder().encode('image bytes')],
    ]);
    const readPaths: string[] = [];

    const content = await inlineHtmlAssets(['index.html'], '/site', async path => {
      readPaths.push(path);
      const resource = resources.get(path);
      if (!resource) throw new Error(`Unexpected asset path: ${path}`);
      return resource;
    });

    expect(content).toContain('<!doctype html>');
    expect(content).toContain('<html>');
    expect(content).toContain('<head>');
    expect(content).toContain('<body>');
    expect(content).toContain('<style media="screen" data-href="metadata">');
    expect(content).toContain(String.raw`content: "<\/style>"`);
    expect(content).toContain('<script type="module" data-src="metadata">');
    expect(content).toContain(String.raw`const close = '<\/script>';`);
    expect(content).toContain(`const snippet = '<img src="inline.png">';`);
    expect(content).toContain('data-src="metadata.png"');
    expect(content).toContain('src="data:image/png;base64,');
    expect(readPaths).toEqual([
      '/site/index.html',
      '/site/site.css',
      '/site/app.js',
      '/site/photo.png',
    ]);
  });
});
