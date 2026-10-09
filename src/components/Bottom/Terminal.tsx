import { useEffect, useState } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { ClientTerminal, type TerminalProps } from './ClientTerminal';

export default function Terminal(props: TerminalProps) {
  const [isMounted, setIsMounted] = useState(false);
  const { colors } = useTheme();
  const { t } = useTranslation();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ height: `${props.height - 32}px`, background: colors.editorBg }}
      >
        <div className="text-sm" style={{ color: colors.mutedFg }}>
          {t('bottom.terminalInitializing')}
        </div>
      </div>
    );
  }

  return <ClientTerminal {...props} />;
}
