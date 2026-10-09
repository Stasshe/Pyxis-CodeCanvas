import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChangeEvent } from '@/engine/core/fs/index';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<{
    dependencies: readonly unknown[];
    cleanup?: () => void;
  } | null>,
  pendingEffects: [] as Array<{
    index: number;
    callback: () => void | (() => void);
  }>,
  inlineHtmlAssets:
    vi.fn<
      (
        files: string[],
        path: string,
        readFile: (path: string) => Promise<Uint8Array>,
        requestedHtmlFile?: string,
        onDependency?: (path: string) => void
      ) => Promise<string>
    >(),
  changeListener: null as ((event: FsChangeEvent) => void) | null,
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: <T>(callback: T) => {
      hooks.cursor += 1;
      return callback;
    },
    useEffect: (callback: () => void | (() => void), dependencies: readonly unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.effects[index];
      const changed =
        !previous ||
        previous.dependencies.length !== dependencies.length ||
        dependencies.some((dependency, position) => dependency !== previous.dependencies[position]);
      if (changed) hooks.pendingEffects.push({ index, callback });
      hooks.effects[index] = { ...previous, dependencies };
    },
    useRef: <T>(current: T) => {
      const index = hooks.cursor++;
      if (!hooks.refs[index]) hooks.refs[index] = { current };
      return hooks.refs[index] as { current: T };
    },
    useState: <T>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) {
        hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        const previous = hooks.states[index] as T;
        hooks.states[index] =
          typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      };
      return [hooks.states[index] as T, setState] as const;
    },
  };
});

vi.mock('@/context/I18nContext', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/engine/ide/importExport/inlineHtmlAssets', () => ({ inlineHtmlAssets: hooks.inlineHtmlAssets }));

import WebPreviewTab from '@/components/preview/WebPreviewTab';
import { fsClient } from '@/engine/core/fs/index';

function renderPreview(filePath: string): void {
  hooks.cursor = 0;
  hooks.pendingEffects = [];
  WebPreviewTab({ filePath });
  for (const pending of hooks.pendingEffects) {
    hooks.effects[pending.index]?.cleanup?.();
    const cleanup = pending.callback();
    const effect = hooks.effects[pending.index];
    if (effect) effect.cleanup = cleanup || undefined;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('WebPreviewTab', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    hooks.refs = [];
    hooks.effects = [];
    hooks.pendingEffects = [];
    hooks.changeListener = null;
    hooks.inlineHtmlAssets.mockReset();
    vi.spyOn(fsClient, 'init').mockResolvedValue(undefined);
    vi.spyOn(fsClient, 'stat').mockResolvedValue({ type: 'file' } as Awaited<
      ReturnType<typeof fsClient.stat>
    >);
    vi.spyOn(fsClient, 'readdir').mockResolvedValue([]);
    vi.spyOn(fsClient, 'addChangeListener').mockImplementation(listener => {
      hooks.changeListener = listener;
      return vi.fn();
    });
  });

  afterEach(() => {
    for (const effect of hooks.effects) effect?.cleanup?.();
    vi.restoreAllMocks();
  });

  it('ignores preview content from an older path when its load finishes late', async () => {
    const firstLoad = deferred<string>();
    hooks.inlineHtmlAssets.mockImplementationOnce(() => firstLoad.promise);
    hooks.inlineHtmlAssets.mockResolvedValueOnce('<h1>second file</h1>');

    renderPreview('/site/first.html');
    await vi.waitFor(() => expect(hooks.inlineHtmlAssets).toHaveBeenCalledTimes(1));
    renderPreview('/site/second.html');
    await vi.waitFor(() => expect(hooks.states).toContain('<h1>second file</h1>'));

    firstLoad.resolve('<h1>first file</h1>');
    await Promise.resolve();
    await Promise.resolve();

    expect(hooks.states).toContain('<h1>second file</h1>');
    expect(hooks.states).not.toContain('<h1>first file</h1>');
  });

  it('reloads an HTML preview when a referenced sibling or outside-root asset changes', async () => {
    hooks.inlineHtmlAssets.mockImplementationOnce(
      async (_files, _path, _readFile, _htmlFile, recordDependency) => {
        recordDependency?.('/site/assets/theme.css');
        recordDependency?.('/shared/theme.css');
        return '<h1>preview</h1>';
      }
    );
    renderPreview('/site/index.html');
    await vi.waitFor(() => expect(hooks.inlineHtmlAssets).toHaveBeenCalledOnce());
    const listener = hooks.changeListener;
    expect(listener).toBeTypeOf('function');

    listener?.({ type: 'update', path: '/site/assets/theme.css' });
    expect(hooks.states).toContain(1);

    listener?.({ type: 'rename', path: '/site/moved-assets', oldPath: '/site/assets' });
    expect(hooks.states).toContain(2);

    listener?.({ type: 'update', path: '/shared/theme.css' });
    expect(hooks.states).toContain(3);

    listener?.({ type: 'update', path: '/site/unreferenced.css' });
    expect(hooks.states).not.toContain(4);
  });

  it('reloads a directory preview when a descendant changes under the filesystem root', async () => {
    vi.mocked(fsClient.stat).mockResolvedValue({ type: 'directory' } as Awaited<
      ReturnType<typeof fsClient.stat>
    >);
    vi.mocked(fsClient.readdir).mockResolvedValue([
      { type: 'file', path: '/index.html' },
    ] as Awaited<ReturnType<typeof fsClient.readdir>>);
    hooks.inlineHtmlAssets.mockResolvedValue('<h1>root preview</h1>');

    renderPreview('/');
    await vi.waitFor(() => expect(hooks.inlineHtmlAssets).toHaveBeenCalledOnce());
    hooks.changeListener?.({ type: 'update', path: '/site/index.html' });

    expect(hooks.states).toContain(1);
  });
});
