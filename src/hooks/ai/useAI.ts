// 統合AIフック

import { useCallback, useEffect, useRef, useState } from 'react';

import { LOCALSTORAGE_KEY } from '@/constants/config';
import { getCustomInstructions, getSelectedFileContexts } from '@/engine/ai/contextBuilder';
import { generateChatResponse, generateCodeEdit } from '@/engine/ai/fetchAI';
import { ASK_PROMPT_TEMPLATE, EDIT_PROMPT_TEMPLATE } from '@/engine/ai/prompts';
import {
  extractFilePathsFromResponse,
  parseEditResponse,
  validateResponse,
} from '@/engine/ai/responseParser';
import { readAIText } from '@/engine/ai/textEdits';
import { fsClient } from '@/engine/core/fs';
import { saveAIReviewEntry } from '@/engine/storage/aiStorageAdapter';
import { pushLogMessage } from '@/stores/loggerStore';
import type { AIEditResponse, AIFileContext, ChatSpaceMessage } from '@/types';
import {
  type AIRequestIdentity,
  isAIRequestIdentityCurrent,
  updateAIRequestIdentity,
} from './requestIdentity';

interface UseAIProps {
  onAddMessage?: (
    content: string,
    type: 'user' | 'assistant',
    mode: 'ask' | 'edit',
    fileContext?: string[],
    editResponse?: AIEditResponse,
    targetSpaceId?: string | null
  ) => Promise<ChatSpaceMessage | null>;
  selectedFiles?: string[];
  onUpdateSelectedFiles?: (files: string[]) => Promise<void>;
  onSelectionError?: (message: string) => void;
  messages?: ChatSpaceMessage[];
  rootPath?: string | null;
  spaceId?: string | null;
}

export function useAI(props?: UseAIProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileContexts, setFileContexts] = useState<AIFileContext[]>([]);
  const fileContextsRef = useRef(fileContexts);
  const activeIdentityRef = useRef<AIRequestIdentity>({
    rootPath: props?.rootPath ?? null,
    spaceId: props?.spaceId ?? null,
    generation: 0,
  });
  const processingRequestsRef = useRef(0);
  const pendingTargetSpaceRef = useRef<{ rootPath: string; spaceId: string } | null>(null);
  const fileContextsRootRef = useRef<string | null>(props?.rootPath ?? null);
  const nextRootPath = props?.rootPath ?? null;
  const nextSpaceId = props?.spaceId ?? null;
  const pendingTarget = pendingTargetSpaceRef.current;
  if (pendingTarget) {
    if (
      pendingTarget.rootPath !== nextRootPath ||
      (nextSpaceId !== null && nextSpaceId !== pendingTarget.spaceId)
    ) {
      pendingTargetSpaceRef.current = null;
    }
  }
  const effectiveSpaceId =
    nextSpaceId === null && pendingTargetSpaceRef.current?.rootPath === nextRootPath
      ? pendingTargetSpaceRef.current.spaceId
      : nextSpaceId;
  activeIdentityRef.current = updateAIRequestIdentity(
    activeIdentityRef.current,
    nextRootPath,
    effectiveSpaceId
  );
  if (nextSpaceId === pendingTargetSpaceRef.current?.spaceId) {
    pendingTargetSpaceRef.current = null;
  }

  const isCurrentRequest = useCallback(
    (identity: typeof activeIdentityRef.current): boolean =>
      isAIRequestIdentityCurrent(identity, activeIdentityRef.current),
    []
  );

  const pendingSelectionRef = useRef<{
    rootPath: string | null;
    spaceId: string | null;
    paths: string[];
  } | null>(null);
  const saveSelectedPaths = useCallback(
    (paths: string[]) => {
      const identity = { ...activeIdentityRef.current };
      pendingSelectionRef.current = { ...identity, paths };
      if (!props?.onUpdateSelectedFiles) return;
      void props.onUpdateSelectedFiles(paths).catch(error => {
        if (!isCurrentRequest(identity)) return;
        const message = `Failed to update selected AI files: ${error instanceof Error ? error.message : String(error)}`;
        console.error('[useAI] Failed to save selected files:', error);
        pushLogMessage(message, 'error', 'AI');
        props.onSelectionError?.(message);
      });
    },
    [isCurrentRequest, props?.onUpdateSelectedFiles, props?.onSelectionError]
  );

  useEffect(() => {
    if (fileContextsRootRef.current !== activeIdentityRef.current.rootPath || !props?.selectedFiles)
      return;
    const pending = pendingSelectionRef.current;
    if (pending && pending.rootPath === nextRootPath && pending.spaceId === nextSpaceId) {
      if (
        pending.paths.length !== props.selectedFiles.length ||
        pending.paths.some((path, index) => path !== props.selectedFiles?.[index])
      )
        return;
    }
    pendingSelectionRef.current = null;
    const updated = fileContextsRef.current.map(context => ({
      ...context,
      selected: props.selectedFiles?.includes(context.path) || false,
    }));
    fileContextsRef.current = updated;
    setFileContexts(updated);
  }, [props?.selectedFiles, nextRootPath, nextSpaceId]);

  // メッセージを追加
  const addMessage = useCallback(
    async (
      content: string,
      type: 'user' | 'assistant',
      mode: 'ask' | 'edit' = 'ask',
      fileContext?: string[],
      editResponse?: AIEditResponse,
      targetSpaceId?: string | null
    ): Promise<ChatSpaceMessage | null> => {
      if (props?.onAddMessage) {
        const result = await props.onAddMessage(
          content,
          type,
          mode,
          fileContext,
          editResponse,
          targetSpaceId
        );
        if (!result) throw new Error('Failed to save the AI message to chat history.');
        return result;
      }
      // Always push assistant responses to the BottomPanel so user sees AI replies
      try {
        if (type === 'assistant') {
          const ctx = mode === 'edit' ? 'AI (edit)' : 'AI';
          const msg = typeof content === 'string' ? content : JSON.stringify(content);
          pushLogMessage(msg, 'info', ctx);
        }
      } catch (e) {
        console.warn('[useAI] pushLogMessage failed', e);
      }
      return null;
    },
    [props?.onAddMessage]
  );

  // メッセージを送信（Ask/Edit統合）
  const sendMessage = useCallback(
    async (
      content: string,
      mode: 'ask' | 'edit',
      targetSpaceId?: string
    ): Promise<AIEditResponse | null> => {
      const apiKey = localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY);
      if (!apiKey) {
        throw new Error('Gemini APIキーが設定されていません。設定画面で設定してください。');
      }

      const requestIdentity = targetSpaceId
        ? updateAIRequestIdentity(activeIdentityRef.current, props?.rootPath ?? null, targetSpaceId)
        : { ...activeIdentityRef.current };
      const activeIdentity = activeIdentityRef.current;
      if (
        targetSpaceId &&
        activeIdentity.rootPath === requestIdentity.rootPath &&
        (activeIdentity.spaceId === null || activeIdentity.spaceId === targetSpaceId)
      ) {
        activeIdentityRef.current = requestIdentity;
        if (activeIdentity.spaceId === null && requestIdentity.rootPath) {
          pendingTargetSpaceRef.current = {
            rootPath: requestIdentity.rootPath,
            spaceId: targetSpaceId,
          };
        }
      }
      processingRequestsRef.current += 1;
      setIsProcessing(true);
      let userMessageSaved = false;

      try {
        const activeFileContexts =
          fileContextsRootRef.current === requestIdentity.rootPath ? fileContextsRef.current : [];
        const selectedFiles = getSelectedFileContexts(activeFileContexts);
        // ユーザーメッセージを追加
        await addMessage(
          content,
          'user',
          mode,
          selectedFiles.map(f => f.path),
          undefined,
          requestIdentity.spaceId
        );
        userMessageSaved = true;
        if (!isCurrentRequest(requestIdentity)) return null;

        // 過去メッセージから必要な情報のみ抽出（editResponseも含めてプロンプト最適化に使用）
        const previousMessages = props?.messages
          ?.filter(msg => typeof msg.content === 'string' && msg.content.trim().length > 0)
          ?.map(msg => ({
            type: msg.type,
            content: msg.content,
            mode: msg.mode,
            editResponse: msg.editResponse, // プロンプト最適化用
          }));

        // Get custom instructions if available
        const customInstructions = getCustomInstructions(activeFileContexts);

        if (mode === 'ask') {
          // Ask モード
          const prompt = ASK_PROMPT_TEMPLATE(
            selectedFiles,
            content,
            previousMessages,
            customInstructions
          );
          const response = await generateChatResponse(prompt, [], apiKey);

          if (!isCurrentRequest(requestIdentity)) return null;
          await addMessage(
            response,
            'assistant',
            'ask',
            undefined,
            undefined,
            requestIdentity.spaceId
          );
          return null;
        }
        // Edit モード
        if (!props?.rootPath) {
          throw new Error('A workspace root path is required to edit files.');
        }

        const prompt = EDIT_PROMPT_TEMPLATE(
          selectedFiles,
          content,
          previousMessages,
          customInstructions
        );
        const response = await generateCodeEdit(prompt, apiKey);
        if (!isCurrentRequest(requestIdentity)) return null;

        // レスポンスのバリデーション
        const validation = validateResponse(response);
        if (!validation.isValid) {
          console.warn('[useAI] Response validation errors:', validation.errors);
        }
        if (validation.warnings.length > 0) {
          console.warn('[useAI] Response validation warnings:', validation.warnings);
        }

        // レスポンスをパース
        const responsePaths = extractFilePathsFromResponse(response, props.rootPath);
        // 重複を避けるため、既に selectedFiles に含まれているパスを除外
        const selectedPathsSet = new Set(selectedFiles.map(f => f.path));
        const newPaths = responsePaths.filter((path: string) => !selectedPathsSet.has(path));

        for (const path of responsePaths) {
          if (selectedPathsSet.has(path)) {
            const exists = await fsClient.exists(path);
            if (!isCurrentRequest(requestIdentity)) return null;
            if (exists) {
              await readAIText(path);
              if (!isCurrentRequest(requestIdentity)) return null;
            }
          }
        }

        // Load existing file content for response paths outside the selected contexts.
        interface OriginalFileWithMeta {
          path: string;
          content: string;
          isNewFile: boolean;
        }

        const newFilesWithContent = await Promise.all(
          newPaths.map(async (path): Promise<OriginalFileWithMeta | null> => {
            const exists = await fsClient.exists(path);
            if (!isCurrentRequest(requestIdentity)) return null;
            if (!exists) return { path, content: '', isNewFile: true };

            const fileContent = await readAIText(path);
            if (!isCurrentRequest(requestIdentity)) return null;
            return { path, content: fileContent, isNewFile: false };
          })
        );
        if (!isCurrentRequest(requestIdentity)) return null;

        const allOriginalFiles: OriginalFileWithMeta[] = [
          ...selectedFiles.map(f => ({ path: f.path, content: f.content, isNewFile: false })),
          ...newFilesWithContent.filter((file): file is OriginalFileWithMeta => file !== null),
        ];

        // Create a map of paths to isNewFile status
        const newFileMap = new Map(allOriginalFiles.map(f => [f.path, f.isNewFile]));

        const parseResult = parseEditResponse(response, allOriginalFiles, props.rootPath);

        // AIEditResponse形式に変換 (add isNewFile flag for each file)
        const editResponse: AIEditResponse = {
          changedFiles: parseResult.changedFiles.map(f => ({
            ...f,
            isNewFile: newFileMap.get(f.path) || false,
          })),
          message: parseResult.message,
        };

        // 詳細メッセージを生成
        let detailedMessage = editResponse.message;
        if (editResponse.changedFiles.length > 0) {
          const usedPatch = parseResult.usedPatchFormat;
          const formatNote = usedPatch ? ' (using patch format)' : '';
          detailedMessage = `Edit complete!${formatNote}\n\n**Changed files:** ${editResponse.changedFiles.length}\n\n`;
          editResponse.changedFiles.forEach((file, index) => {
            const newLabel = file.isNewFile ? ' (new)' : '';
            detailedMessage += `${index + 1}. **${file.path}**${newLabel}\n`;
            if (file.explanation) {
              detailedMessage += `   - ${file.explanation}\n`;
            }
            detailedMessage += '\n';
          });
          detailedMessage += editResponse.message;
        }

        // Append assistant edit message and capture returned message (so we know its id)
        if (!isCurrentRequest(requestIdentity)) return null;
        const assistantMsg = await addMessage(
          detailedMessage,
          'assistant',
          'edit',
          [],
          editResponse,
          requestIdentity.spaceId
        );
        if (!isCurrentRequest(requestIdentity)) return null;

        // Persist AI review metadata / snapshots using storage adapter when rootPath provided
        if (requestIdentity.rootPath && isCurrentRequest(requestIdentity)) {
          for (const f of editResponse.changedFiles) {
            saveAIReviewEntry(
              requestIdentity.rootPath,
              f.path,
              f.originalContent,
              f.suggestedContent,
              {
                message: parseResult.message,
                parentMessageId: assistantMsg?.id,
              }
            ).catch(err => console.warn('[useAI] saveAIReviewEntry failed', err));
          }
        }

        return editResponse;
      } catch (error) {
        if (!isCurrentRequest(requestIdentity)) return null;
        const errorMessage = `Error: ${(error as Error).message}`;
        if (userMessageSaved) {
          try {
            await addMessage(
              errorMessage,
              'assistant',
              mode,
              undefined,
              undefined,
              requestIdentity.spaceId
            );
          } catch (messageError) {
            console.warn('[useAI] Failed to save the error message:', messageError);
          }
        }
        throw error;
      } finally {
        processingRequestsRef.current -= 1;
        setIsProcessing(processingRequestsRef.current > 0);
      }
    },
    [addMessage, isCurrentRequest, props?.messages, props?.rootPath]
  );

  // ファイルコンテキストを更新
  const updateFileContexts = useCallback(
    (contexts: AIFileContext[], persistSelection = true) => {
      fileContextsRootRef.current = activeIdentityRef.current.rootPath;
      fileContextsRef.current = contexts;
      setFileContexts(contexts);
      if (!persistSelection) {
        pendingSelectionRef.current = {
          rootPath: activeIdentityRef.current.rootPath,
          spaceId: activeIdentityRef.current.spaceId,
          paths: contexts.filter(context => context.selected).map(context => context.path),
        };
      }

      if (persistSelection) {
        saveSelectedPaths(contexts.filter(ctx => ctx.selected).map(ctx => ctx.path));
      }
    },
    [saveSelectedPaths]
  );

  // ファイルの選択状態を切り替え
  const toggleFileSelection = useCallback(
    (path: string) => {
      if (fileContextsRootRef.current !== activeIdentityRef.current.rootPath) return;
      const updated = fileContextsRef.current.map(ctx =>
        ctx.path === path ? { ...ctx, selected: !ctx.selected } : ctx
      );
      fileContextsRef.current = updated;
      setFileContexts(updated);

      saveSelectedPaths(updated.filter(ctx => ctx.selected).map(ctx => ctx.path));
    },
    [saveSelectedPaths]
  );

  const clearFileContexts = useCallback(() => {
    fileContextsRootRef.current = activeIdentityRef.current.rootPath;
    fileContextsRef.current = [];
    setFileContexts([]);
  }, []);

  /**
   * Generate the AI prompt text for debugging purposes without actually sending to the API.
   * Useful for inspecting what prompt would be sent to the AI model.
   * @param content - The user's input message
   * @param mode - The current mode ('ask' for questions, 'edit' for code editing)
   * @returns The full prompt text that would be sent to the AI
   */
  const generatePromptText = useCallback(
    (content: string, mode: 'ask' | 'edit'): string => {
      const activeFileContexts =
        fileContextsRootRef.current === activeIdentityRef.current.rootPath
          ? fileContextsRef.current
          : [];
      const selectedFiles = getSelectedFileContexts(activeFileContexts);
      const customInstructions = getCustomInstructions(activeFileContexts);

      const previousMessages = props?.messages
        ?.filter(msg => typeof msg.content === 'string' && msg.content.trim().length > 0)
        ?.map(msg => ({
          type: msg.type,
          content: msg.content,
          mode: msg.mode,
          editResponse: msg.editResponse,
        }));

      if (mode === 'ask') {
        return ASK_PROMPT_TEMPLATE(selectedFiles, content, previousMessages, customInstructions);
      }
      return EDIT_PROMPT_TEMPLATE(selectedFiles, content, previousMessages, customInstructions);
    },
    [props?.messages]
  );

  return {
    messages: props?.messages || [],
    isProcessing,
    fileContexts,
    sendMessage,
    updateFileContexts,
    clearFileContexts,
    toggleFileSelection,
    generatePromptText,
  };
}
