import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExtensionContext } from '../_shared/types';

interface BinaryEditorDocument {
  bytes: Uint8Array;
  savedBytes: Uint8Array;
  isLoaded: boolean;
  isSaving: boolean;
  error: string | null;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function useBinaryEditorDocument(
  context: ExtensionContext | null,
  tabId: string,
  filePath: string | undefined
) {
  const [document, setDocument] = useState<BinaryEditorDocument>({
    bytes: new Uint8Array(0),
    savedBytes: new Uint8Array(0),
    isLoaded: false,
    isSaving: false,
    error: null,
  });
  const initialFilePath = useRef(filePath);
  const isModified = useMemo(
    () => !bytesEqual(document.bytes, document.savedBytes),
    [document.bytes, document.savedBytes]
  );
  const currentState = useRef({ isModified, isSaving: document.isSaving });
  currentState.current = { isModified, isSaving: document.isSaving };

  useEffect(() => {
    let cancelled = false;
    const path = initialFilePath.current;
    if (!path || !context) {
      setDocument(current => ({ ...current, error: 'File path is missing', isLoaded: false }));
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      try {
        const fsClient = await context.getSystemModule('fsClient');
        const bytes = await fsClient.readFile(path);
        if (cancelled) return;
        const copy = new Uint8Array(bytes);
        setDocument({
          bytes: copy,
          savedBytes: new Uint8Array(copy),
          isLoaded: true,
          isSaving: false,
          error: null,
        });
      } catch (error) {
        if (cancelled) return;
        let message = 'File read failed';
        if (error instanceof Error) message = error.message;
        setDocument(current => ({ ...current, isLoaded: false, error: message }));
        context.logger.error(`Failed to load ${path}: ${message}`);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [context]);

  useEffect(() => {
    if (document.isLoaded) context?.tabs.updateTab(tabId, { isDirty: isModified });
  }, [context, document.isLoaded, isModified, tabId]);

  useEffect(() => {
    if (!context || !filePath || !document.isLoaded) return;
    let cancelled = false;
    let removeListener = () => {};
    const attach = async () => {
      const fsClient = await context.getSystemModule('fsClient');
      if (cancelled) return;
      removeListener = fsClient.addChangeListener(event => {
        if (event.type === 'rename' && event.oldPath === filePath) {
          void context
            .getSystemModule('pathUtils')
            .then(pathUtils => {
              context.tabs.updateTab(tabId, {
                data: { filePath: event.path, fileName: pathUtils.basename(event.path) },
              });
            })
            .catch(error => {
              context.logger.error(`Failed to track rename of ${filePath}: ${error}`);
            });
          return;
        }
        if (event.path !== filePath) return;
        if (event.type === 'delete' && !currentState.current.isModified) {
          setDocument(current => ({ ...current, error: 'File was removed from the workspace' }));
          return;
        }
        if (
          event.type !== 'update' ||
          currentState.current.isModified ||
          currentState.current.isSaving
        )
          return;
        void fsClient
          .readFile(filePath)
          .then(bytes => {
            if (cancelled) return;
            if (currentState.current.isModified || currentState.current.isSaving) return;
            const copy = new Uint8Array(bytes);
            setDocument(current => ({
              ...current,
              bytes: copy,
              savedBytes: new Uint8Array(copy),
              error: null,
            }));
          })
          .catch(error => {
            if (cancelled) return;
            let message = 'File reload failed';
            if (error instanceof Error) message = error.message;
            setDocument(current => ({ ...current, error: message }));
            context.logger.error(`Failed to reload ${filePath}: ${message}`);
          });
      });
    };
    void attach();
    return () => {
      cancelled = true;
      removeListener();
    };
  }, [context, document.isLoaded, filePath, tabId]);

  const setBytes = useCallback((bytes: Uint8Array) => {
    setDocument(current => ({ ...current, bytes, error: null }));
  }, []);

  const save = useCallback(async () => {
    if (!context || !filePath || !document.isLoaded || document.isSaving) return;
    const bytes = new Uint8Array(document.bytes);
    setDocument(current => ({ ...current, isSaving: true, error: null }));
    try {
      const fsClient = await context.getSystemModule('fsClient');
      await fsClient.writeFile(filePath, bytes);
      setDocument(current => ({
        ...current,
        savedBytes: bytes,
        isSaving: false,
      }));
      context.logger.info(`Saved: ${filePath}`);
    } catch (error) {
      let message = 'File save failed';
      if (error instanceof Error) message = error.message;
      setDocument(current => ({ ...current, isSaving: false, error: message }));
      context.logger.error(`Failed to save ${filePath}: ${message}`);
    }
  }, [context, document.bytes, document.isLoaded, document.isSaving, filePath]);

  return { ...document, isModified, setBytes, save };
}
