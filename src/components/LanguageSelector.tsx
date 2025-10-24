/**
 * Language Selector Component
 * 言語切り替えドロップダウン
 */

'use client';

import { Languages } from 'lucide-react';
import { useI18n } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { Locale } from '@/engine/i18n/types';

interface LanguageSelectorProps {
  className?: string;
}

const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
};

export default function LanguageSelector({ className = '' }: LanguageSelectorProps) {
  const { locale, setLocale, isLoading } = useI18n();
  const { colors } = useTheme();

  const handleChange = (newLocale: Locale) => {
    if (newLocale !== locale && !isLoading) {
      setLocale(newLocale);
    }
  };

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Languages
        size={16}
        style={{ color: colors.mutedFg }}
      />
      <select
        value={locale}
        onChange={e => handleChange(e.target.value as Locale)}
        disabled={isLoading}
        style={{
          background: colors.mutedBg,
          color: colors.foreground,
          border: `1px solid ${colors.border}`,
          borderRadius: '0.375rem',
          padding: '0.25rem 0.5rem',
          fontSize: '0.875rem',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          opacity: isLoading ? 0.5 : 1,
        }}
        className="outline-none"
      >
        {(Object.keys(LOCALE_NAMES) as Locale[]).map(loc => (
          <option
            key={loc}
            value={loc}
          >
            {LOCALE_NAMES[loc]}
          </option>
        ))}
      </select>
    </div>
  );
}
