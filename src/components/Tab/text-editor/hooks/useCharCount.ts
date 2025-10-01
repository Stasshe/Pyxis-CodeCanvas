import { useState, useEffect } from 'react';
import { countCharsNoSpaces } from '../editors/editor-utils';

/**
 * 文字数カウント管理フック
 */
export function useCharCount(content: string | undefined) {
  const [charCount, setCharCount] = useState(0);
  const [selectionCount, setSelectionCount] = useState<number | null>(null);
  const [showCharCountPopup, setShowCharCountPopup] = useState(false);

  useEffect(() => {
    setCharCount(countCharsNoSpaces(content || ''));
    setSelectionCount(null);
  }, [content]);

  return {
    charCount,
    setCharCount,
    selectionCount,
    setSelectionCount,
    showCharCountPopup,
    setShowCharCountPopup,
  };
}
