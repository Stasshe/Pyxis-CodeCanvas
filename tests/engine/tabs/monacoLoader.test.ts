import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: vi.fn() }));

vi.mock('@monaco-editor/react', () => ({ loader: { config: state.config } }));

import { monacoVsPath } from '@/engine/tabs/monacoLoader';
import monacoPackage from '../../../node_modules/monaco-editor/package.json';

describe('Monaco loader runtime path', () => {
  it('loads the CDN runtime that matches the installed Monaco package', () => {
    const expectedPath = `https://cdn.jsdelivr.net/npm/monaco-editor@${monacoPackage.version}/min/vs`;

    expect(monacoVsPath).toBe(expectedPath);
    expect(state.config).toHaveBeenCalledOnce();
    expect(state.config).toHaveBeenCalledWith({ paths: { vs: expectedPath } });
  });
});
