/**
 * useSettings - Pyxis設定を使用するためのReact Hook
 */

import { useState, useEffect, useMemo } from 'react';

import { settingsManager } from '@/engine/helper/settingsManager';
import { PyxisSettings } from '@/types/settings';

export function useSettings(projectId?: string) {
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

  // 除外パターンを正規表現配列に変換
  const excludeRegexps = useMemo(() => {
    const patterns = settings?.search?.exclude || [];
    return patterns.map((pat: string) => {
      // VSCodeのglob仕様に近い除外パターン変換
      // 1. **/dir → どこかの階層に現れるdirディレクトリとその配下すべて
      // 2. dir/** → 直下のdir配下すべて
      // 3. **/foo/** → どこかの階層に現れるfoo配下すべて
      // 4. *.ext, foo/bar なども考慮

      // 1. **/dir or **/dir/ or **/dir/**
      const m1 = pat.match(/^\*\*\/(.+?)(\/\*\*)?$/);
      if (m1) {
        // 例: **/node_modules, **/foo, **/foo/**
        const dir = m1[1].replace(/[.+^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|\/)${dir}($|\/)`);
      }
      // 2. dir/**
      const m2 = pat.match(/^([^*?/]+)\/\*\*$/);
      if (m2) {
        const dir = m2[1].replace(/[.+^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^${dir}\/`);
      }
      // 3. **/foo/**
      const m3 = pat.match(/^\*\*\/(.+)\/\*\*$/);
      if (m3) {
        const dir = m3[1].replace(/[.+^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|\/)${dir}\/`);
      }
      // 4. その他: glob風パターンを正規表現に変換（厳密化）
      let regexStr = pat
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // エスケープ
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');
      if (!regexStr.startsWith('.*') && pat.startsWith('**')) regexStr = '.*' + regexStr;
      if (pat.endsWith('/')) regexStr = regexStr + '.*';
      if (pat.startsWith('*/')) regexStr = '[^/]*' + regexStr.slice(1);
      if (pat.endsWith('/*')) regexStr = regexStr.slice(0, -2) + '/[^/]*';
      return new RegExp('^' + regexStr + '$');
    });
  }, [settings]);

  // 除外判定関数
  const isExcluded = (path: string): boolean => {
    return excludeRegexps.some(re => re.test(path));
  };

  const updateSettings = async (updates: Partial<PyxisSettings>) => {
    if (!projectId || !settings) return;
    try {
      await settingsManager.updateSettings(projectId, updates);
    } catch (error) {
      console.error('[useSettings] Failed to update settings:', error);
      throw error;
    }
  };

  return { settings, isLoading, updateSettings, isExcluded };
}
