import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  setters: [] as Array<(value: unknown) => void>,
  loadImageAsDataURL: vi.fn<(path: string) => Promise<string>>(),
}));

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect),
  useState: (initialValue: unknown) => [
    initialValue,
    (value: unknown) => mocks.setters.push(value),
  ],
}));

vi.mock('@/context/I18nContext', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/Tab/markdownUtils', () => ({
  loadImageAsDataURL: mocks.loadImageAsDataURL,
}));

import LocalImage from '@/components/Tab/LocalImage';

describe('LocalImage', () => {
  beforeEach(() => {
    mocks.effects = [];
    mocks.setters = [];
    mocks.loadImageAsDataURL.mockReset();
  });

  it('ignores a local image load that finishes after the source changes', async () => {
    let resolveLoad: (dataUrl: string) => void = () => {};
    mocks.loadImageAsDataURL.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveLoad = resolve;
        })
    );

    LocalImage({ src: '/first.png' });
    const cleanup = mocks.effects[0]?.();
    expect(cleanup).toBeTypeOf('function');

    mocks.setters = [];
    cleanup?.();
    resolveLoad('data:image/png;base64,Zmlyc3Q=');
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.setters).toEqual([]);
  });
});
