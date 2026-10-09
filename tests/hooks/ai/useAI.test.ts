import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({
  generateChatResponse: vi.fn(),
  generateCodeEdit: vi.fn(),
  exists: vi.fn(),
  readAIText: vi.fn(),
  addMessage: vi.fn(),
  askPrompt: vi.fn(
    (
      _files: Array<{ path: string; content: string }>,
      _content: string,
      _messages: object | undefined,
      _instructions: string
    ) => 'ask prompt'
  ),
  saveAIReviewEntry: vi.fn(),
}));

vi.mock('@/engine/ide/ai/contextBuilder', () => ({
  getCustomInstructions: () => '',
  getSelectedFileContexts: (
    contexts: Array<{ path: string; content: string; selected: boolean }>
  ) => contexts.filter(context => context.selected).map(({ path, content }) => ({ path, content })),
}));

vi.mock('@/engine/ide/ai/fetchAI', () => ({
  generateChatResponse: hookState.generateChatResponse,
  generateCodeEdit: hookState.generateCodeEdit,
}));

vi.mock('@/engine/ide/ai/prompts', () => ({
  ASK_PROMPT_TEMPLATE: hookState.askPrompt,
  EDIT_PROMPT_TEMPLATE: () => 'edit prompt',
}));

vi.mock('@/engine/ide/ai/responseParser', () => ({
  extractFilePathsFromResponse: () => ['/workspace/file.ts'],
  parseEditResponse: () => ({
    changedFiles: [
      {
        path: '/workspace/file.ts',
        originalContent: 'before',
        suggestedContent: 'after',
        explanation: '',
      },
    ],
    message: 'Edited',
    usedPatchFormat: false,
  }),
  validateResponse: () => ({ isValid: true, warnings: [], errors: [] }),
}));

vi.mock('@/engine/ide/ai/textEdits', () => ({ readAIText: hookState.readAIText }));
vi.mock('@/engine/core/fs/index', () => ({ fsClient: { exists: hookState.exists } }));
vi.mock('@/engine/core/metadata/aiStorageAdapter', () => ({
  saveAIReviewEntry: hookState.saveAIReviewEntry,
}));
vi.mock('@/stores/loggerStore', () => ({ pushLogMessage: vi.fn() }));

import { useAI } from '@/hooks/ai/useAI';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderHook(props: Parameters<typeof useAI>[0]) {
  let hook!: ReturnType<typeof useAI>;
  function Probe() {
    hook = useAI(props);
    return null;
  }
  renderToString(createElement(Probe));
  return hook;
}

function requestProps(rootPath: string, spaceId: string | null) {
  return {
    rootPath,
    spaceId,
    onAddMessage: hookState.addMessage,
  };
}

describe('useAI request lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', { getItem: () => 'test-api-key' });
    hookState.addMessage.mockResolvedValue({ id: 'message-1' });
    hookState.exists.mockResolvedValue(false);
    hookState.readAIText.mockResolvedValue('before');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('binds an initially empty chat to its newly created target space', async () => {
    const response = deferred<string>();
    const started = deferred<void>();
    hookState.generateChatResponse.mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const hook = renderHook(requestProps('/workspace', null));
    const pending = hook.sendMessage('Question', 'ask', 'new-space');

    await started.promise;
    response.resolve('Answer');
    await pending;

    expect(hookState.addMessage.mock.calls.map(call => [call[1], call[5]])).toEqual([
      ['user', 'new-space'],
      ['assistant', 'new-space'],
    ]);
  });

  it('uses synchronously invalidated contexts for previews and sends before rerender', async () => {
    hookState.generateChatResponse.mockResolvedValue('Answer');
    const hook = renderHook(requestProps('/workspace', 'space-a'));
    hook.updateFileContexts([
      { path: '/workspace/file.ts', content: 'stale contents', selected: true, name: 'file.ts' },
    ]);
    hook.updateFileContexts([]);

    hook.generatePromptText('Question', 'ask');
    await hook.sendMessage('Question', 'ask');

    expect(hookState.askPrompt).toHaveBeenLastCalledWith([], 'Question', undefined, '');
    expect(hookState.addMessage.mock.calls[0][3]).toEqual([]);
  });

  it('uses toggled selection state before rerender', async () => {
    hookState.generateChatResponse.mockResolvedValue('Answer');
    const hook = renderHook(requestProps('/workspace', 'space-a'));
    hook.updateFileContexts([
      { path: '/workspace/file.ts', content: 'file contents', selected: true, name: 'file.ts' },
    ]);
    hook.toggleFileSelection('/workspace/file.ts');

    hook.generatePromptText('Question', 'ask');
    await hook.sendMessage('Question', 'ask');

    expect(hookState.askPrompt).toHaveBeenLastCalledWith([], 'Question', undefined, '');
    expect(hookState.addMessage.mock.calls[0][3]).toEqual([]);
  });

  it('does not call Gemini when saving the user message fails', async () => {
    const props = requestProps('/workspace', 'space-a');
    hookState.addMessage.mockRejectedValue(new Error('chat storage unavailable'));

    await expect(renderHook(props).sendMessage('Edit request', 'edit')).rejects.toThrow(
      'chat storage unavailable'
    );

    expect(hookState.generateCodeEdit).not.toHaveBeenCalled();
    expect(hookState.saveAIReviewEntry).not.toHaveBeenCalled();
    expect(hookState.addMessage).toHaveBeenCalledOnce();
  });

  it('aborts when chat storage does not return a saved user message', async () => {
    const props = requestProps('/workspace', 'space-a');
    hookState.addMessage.mockResolvedValue(null);

    await expect(renderHook(props).sendMessage('Edit request', 'edit')).rejects.toThrow(
      'Failed to save the AI message to chat history.'
    );

    expect(hookState.generateCodeEdit).not.toHaveBeenCalled();
    expect(hookState.saveAIReviewEntry).not.toHaveBeenCalled();
    expect(hookState.addMessage).toHaveBeenCalledOnce();
  });

  it('saves a provider failure to the originating chat before rethrowing it', async () => {
    const failure = new Error('provider unavailable');
    hookState.generateCodeEdit.mockRejectedValue(failure);
    const hook = renderHook(requestProps('/workspace', 'space-a'));

    await expect(hook.sendMessage('Edit request', 'edit')).rejects.toBe(failure);

    expect(hookState.addMessage.mock.calls.map(call => [call[0], call[1], call[5]])).toEqual([
      ['Edit request', 'user', 'space-a'],
      ['Error: provider unavailable', 'assistant', 'space-a'],
    ]);
  });

  it('reports rejected selection persistence without delaying the local prompt state', async () => {
    const failure = new Error('selection storage unavailable');
    const onSelectionError = vi.fn();
    const onUpdateSelectedFiles = vi.fn().mockRejectedValue(failure);
    const hook = renderHook({
      ...requestProps('/workspace', 'space-a'),
      onUpdateSelectedFiles,
      onSelectionError,
    });
    hook.updateFileContexts([
      { path: '/workspace/file.ts', name: 'file.ts', content: 'latest content', selected: true },
    ]);
    hook.generatePromptText('Question', 'ask');
    expect(hookState.askPrompt.mock.calls.at(-1)?.[0]).toEqual([
      { path: '/workspace/file.ts', content: 'latest content' },
    ]);
    await vi.waitFor(() =>
      expect(onSelectionError).toHaveBeenCalledWith(expect.stringContaining(failure.message))
    );
  });
});
