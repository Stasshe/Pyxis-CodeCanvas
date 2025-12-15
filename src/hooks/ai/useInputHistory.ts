import { useCallback, useEffect, useState } from 'react';

interface HistoryEntry {
  content: string;
  selectedFiles: string[];
  mode: 'ask' | 'edit'; // 'ask'と'chat'の両方をサポート
  timestamp: number;
}

interface UseInputHistoryOptions {
  maxHistorySize?: number;
  storageKey?: string;
}

export function useInputHistory(options: UseInputHistoryOptions = {}) {
  const { maxHistorySize = 50, storageKey = 'ai-input-history' } = options;

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [tempInput, setTempInput] = useState('');

  // ローカルストレージから履歴を読み込み
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as HistoryEntry[];
        setHistory(parsed.slice(-maxHistorySize)); // 最大サイズに制限
      }
    } catch (error) {
      console.error('Failed to load input history:', error);
    }
  }, [storageKey, maxHistorySize]);

  // 履歴をローカルストレージに保存
  const saveHistory = useCallback(
    (newHistory: HistoryEntry[]) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(newHistory.slice(-maxHistorySize)));
      } catch (error) {
        console.error('Failed to save input history:', error);
      }
    },
    [storageKey, maxHistorySize]
  );

  // 履歴に新しいエントリを追加
  const addToHistory = useCallback(
    (content: string, selectedFiles: string[] = [], mode: 'ask' | 'edit' = 'ask') => {
      if (!content.trim()) return;

      const newEntry: HistoryEntry = {
        content: content.trim(),
        selectedFiles: [...selectedFiles],
        mode,
        timestamp: Date.now(),
      };

      setHistory(prev => {
        // 同じ内容の重複を避ける
        const filtered = prev.filter(entry => entry.content !== newEntry.content);
        const newHistory = [...filtered, newEntry];
        saveHistory(newHistory);
        return newHistory;
      });

      // インデックスをリセット
      setCurrentIndex(-1);
      setTempInput('');
    },
    [saveHistory]
  );

  // 履歴を前に遡る（古い方向）
  const goToPrevious = useCallback(
    (currentInput: string): HistoryEntry | null => {
      if (history.length === 0) return null;

      let newIndex: number;

      if (currentIndex === -1) {
        // 最初の呼び出し：現在の入力を一時保存し、最新の履歴へ
        setTempInput(currentInput);
        newIndex = history.length - 1;
      } else if (currentIndex > 0) {
        // まだ前の履歴がある場合
        newIndex = currentIndex - 1;
      } else {
        // 最古の履歴に到達している場合
        return null;
      }

      setCurrentIndex(newIndex);
      return history[newIndex];
    },
    [history, currentIndex]
  );

  // 履歴を次に進める（新しい方向）
  const goToNext = useCallback(
    (currentInput: string): string | HistoryEntry | null => {
      if (currentIndex === -1) return null;

      if (currentIndex < history.length - 1) {
        // まだ次の履歴がある場合
        const newIndex = currentIndex + 1;
        setCurrentIndex(newIndex);
        return history[newIndex];
      } else {
        // 最新の履歴に到達：一時保存された入力に戻る
        setCurrentIndex(-1);
        const temp = tempInput;
        setTempInput('');
        return temp;
      }
    },
    [history, currentIndex, tempInput]
  );

  // 履歴をクリア
  const clearHistory = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
    setTempInput('');
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      console.error('Failed to clear input history:', error);
    }
  }, [storageKey]);

  // 現在の履歴エントリを取得
  const getCurrentEntry = useCallback((): HistoryEntry | null => {
    if (currentIndex >= 0 && currentIndex < history.length) {
      return history[currentIndex];
    }
    return null;
  }, [history, currentIndex]);

  return {
    history,
    currentIndex,
    addToHistory,
    goToPrevious,
    goToNext,
    clearHistory,
    getCurrentEntry,
    hasHistory: history.length > 0,
    canGoBack: currentIndex > 0 || (currentIndex === -1 && history.length > 0),
    canGoForward: currentIndex >= 0 && currentIndex < history.length - 1,
  };
}
