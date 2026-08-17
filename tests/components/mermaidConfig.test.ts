import { describe, expect, it } from 'vitest';

import { createMermaidConfig } from '@/components/Tab/MarkdownPreview/mermaidConfig';

const colors = {
  accent: '#2563eb',
  background: '#ffffff',
  border: '#d1d5db',
  cardBg: '#f9fafb',
  foreground: '#111827',
  mutedBg: '#f3f4f6',
};

describe('createMermaidConfig', () => {
  it('creates the application defaults for Mermaid rendering', () => {
    const config = createMermaidConfig({
      colors,
      isDark: false,
    });

    expect(config.layout).toBe('dagre');
    expect(config.flowchart).toMatchObject({
      useMaxWidth: false,
      curve: 'basis',
      rankSpacing: 80,
      nodeSpacing: 50,
    });
    expect(config.htmlLabels).toBe(false);
  });
});
