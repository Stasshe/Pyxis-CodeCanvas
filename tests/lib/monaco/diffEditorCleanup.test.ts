import { describe, expect, it } from 'vitest';

import { detachAndDisposeDiffEditorModels } from '@/lib/monaco/diffEditorCleanup';

describe('detachAndDisposeDiffEditorModels', () => {
  it('detaches the diff widget before disposing retained models', () => {
    let attached = true;
    const calls: string[] = [];
    const editor = {
      setModel(model: null) {
        expect(model).toBeNull();
        attached = false;
        calls.push('detach');
      },
    };
    const model = (name: string, disposed = false) => ({
      isDisposed: () => disposed,
      dispose: () => {
        expect(attached).toBe(false);
        calls.push(`dispose ${name}`);
      },
    });

    detachAndDisposeDiffEditorModels(editor, {
      original: model('original'),
      modified: model('modified', true),
    });

    expect(calls).toEqual(['detach', 'dispose original']);
  });

  it('disposes models that never mounted without an editor', () => {
    const model = { isDisposed: () => false, dispose: () => {} };

    expect(() =>
      detachAndDisposeDiffEditorModels(null, { original: model, modified: null })
    ).not.toThrow();
  });
});
