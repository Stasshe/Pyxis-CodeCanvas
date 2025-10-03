/**
 * useSettings - Pyxis設定を使用するためのReact Hook
 */

import { useState, useEffect } from 'react';
import { settingsManager } from '@/engine/core/settingsManager';
import { PyxisSettings } from '@/types/settings';

export function useSettings(projectId: string | undefined) {
  const [settings, setSettings] = useState<PyxisSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      setIsLoading(false);
      return;
    }

    const loadSettings = async () => {
      setIsLoading(true);
      try {
        const loaded = await settingsManager.loadSettings(projectId);
        setSettings(loaded);
      } catch (error) {
        console.error('[useSettings] Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();

    // 設定変更リスナー
    const unsubscribe = settingsManager.addListener(projectId, newSettings => {
      setSettings(newSettings);
    });

    return unsubscribe;
  }, [projectId]);

  const updateSettings = async (updates: Partial<PyxisSettings>) => {
    if (!projectId || !settings) return;
    try {
      await settingsManager.updateSettings(projectId, updates);
    } catch (error) {
      console.error('[useSettings] Failed to update settings:', error);
      throw error;
    }
  };

  return { settings, isLoading, updateSettings };
}
