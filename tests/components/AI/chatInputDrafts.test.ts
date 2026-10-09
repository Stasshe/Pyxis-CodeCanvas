import { describe, expect, it } from 'vitest';
import {
  clearChatInputDraft,
  openChatInputDraft,
  updateChatInputDraft,
} from '@/components/AI/chat/chatInputDrafts';

describe('ChatInput draft lifecycle', () => {
  it('keeps drafts isolated by workspace and prevents an old submission clearing a reopened draft', () => {
    const firstA = openChatInputDraft('/workspace-a');
    const revisionA = updateChatInputDraft('/workspace-a', firstA.sessionId, 'Question for A');
    const workspaceB = openChatInputDraft('/workspace-b');
    const reopenedA = openChatInputDraft('/workspace-a');

    expect(workspaceB.content).toBe('');
    expect(reopenedA.content).toBe('Question for A');
    expect(clearChatInputDraft('/workspace-a', firstA.sessionId, revisionA)).toBeNull();
    expect(clearChatInputDraft('/workspace-a', reopenedA.sessionId, reopenedA.revision)).toBe(
      reopenedA.revision + 1
    );
    expect(openChatInputDraft('/workspace-a').content).toBe('');
  });

  it('preserves text entered while a submission is pending', () => {
    const session = openChatInputDraft('/workspace-pending');
    const submittedRevision = updateChatInputDraft(
      '/workspace-pending',
      session.sessionId,
      'Submitted text'
    );
    const latestRevision = updateChatInputDraft(
      '/workspace-pending',
      session.sessionId,
      'Newer text'
    );

    expect(
      clearChatInputDraft('/workspace-pending', session.sessionId, submittedRevision)
    ).toBeNull();
    expect(openChatInputDraft('/workspace-pending').content).toBe('Newer text');
    expect(latestRevision).toBeGreaterThan(submittedRevision);
  });
});
