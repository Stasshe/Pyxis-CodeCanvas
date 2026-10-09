import { describe, expect, it } from 'vitest';
import { EDIT_PROMPT_TEMPLATE } from '@/engine/ai/prompts';
import type { ChatSpaceMessage } from '@/types';

describe('AI prompt history', () => {
  it('summarizes edit history without including original or suggested file contents', () => {
    const previousMessages: Array<
      Pick<ChatSpaceMessage, 'type' | 'content' | 'mode' | 'editResponse'>
    > = [
      {
        type: 'assistant',
        content: 'Edit complete',
        mode: 'edit',
        editResponse: {
          message: 'Updated the greeting.',
          changedFiles: [
            {
              path: 'src/greeting.ts',
              explanation: 'Use the localized greeting.',
              originalContent: 'ORIGINAL_SECRET_CONTENT',
              suggestedContent: 'SUGGESTED_SECRET_CONTENT',
            },
          ],
        },
      },
    ];

    const prompt = EDIT_PROMPT_TEMPLATE([], 'Continue the change', previousMessages);

    expect(prompt).toContain('- src/greeting.ts: Use the localized greeting.');
    expect(prompt).not.toContain('ORIGINAL_SECRET_CONTENT');
    expect(prompt).not.toContain('SUGGESTED_SECRET_CONTENT');
  });
});
