'use client';

import React, { useEffect, useState } from 'react';

import { formatKeyComboForDisplay } from '@/hooks/useKeyBindings';

type Props = {
  combo: string;
  className?: string;
  style?: React.CSSProperties;
};

export default function KeyComboClient({ combo, className, style }: Props) {
  const [label, setLabel] = useState<string>('');

  useEffect(() => {
    try {
      const text = formatKeyComboForDisplay(combo);
      setLabel(text);
    } catch (err) {
      setLabel(combo);
    }
  }, [combo]);

  return (
    <span className={className} style={style} aria-hidden>
      {label}
    </span>
  );
}
