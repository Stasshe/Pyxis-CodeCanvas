import type { Monaco } from '@monaco-editor/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useCallback: (callback: unknown) => callback };
});

import { useMonacoModels } from '@/components/Tab/text-editor/hooks/useMonacoModels';

function createModel(content: string, uriValue: string) {
  let value = content;
  return {
    uri: { toString: () => uriValue },
    isDisposed: () => false,
    getLanguageId: () => 'typescript',
    getValue: () => value,
    setValue: vi.fn((nextValue: string) => {
      value = nextValue;
    }),
    dispose: vi.fn(),
  };
}

describe('useMonacoModels', () => {
  it('does not reset an existing editor model when adding another TypeScript model', () => {
    const firstUri = 'inmemory://workspace/ime-regression-a.ts';
    const secondUri = 'inmemory://workspace/ime-regression-b.ts';
    const thirdUri = 'inmemory://workspace/ime-regression-c.ts';
    const firstModel = createModel('const value = 1;', firstUri);
    const secondModel = createModel('export const other = 1;', secondUri);
    const thirdModel = createModel('export const extra = 1;', thirdUri);
    const monaco = {
      Uri: { parse: (value: string) => ({ toString: () => value }) },
      editor: {
        getModel: () => null,
        createModel: vi
          .fn()
          .mockReturnValueOnce(firstModel)
          .mockReturnValueOnce(secondModel)
          .mockReturnValueOnce(thirdModel),
        setModelLanguage: vi.fn(),
        setModelMarkers: vi.fn(),
      },
    } as unknown as Monaco;
    const models = useMonacoModels();

    models.getOrCreateModel(monaco, 'ime-tab-a', 'const value = 1;', 'ime-a.ts', firstUri);
    models.getOrCreateModel(monaco, 'ime-tab-b', 'export const other = 1;', 'ime-b.ts', secondUri);
    models.getOrCreateModel(monaco, 'ime-tab-c', 'export const extra = 1;', 'ime-c.ts', thirdUri);

    expect(firstModel.setValue).not.toHaveBeenCalled();
    expect(secondModel.setValue).not.toHaveBeenCalled();
    expect(thirdModel.setValue).not.toHaveBeenCalled();
  });
});
