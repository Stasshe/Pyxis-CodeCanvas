interface ChatInputDraft {
  content: string;
  revision: number;
  sessionId: number;
}

export interface ChatInputDraftSession {
  content: string;
  revision: number;
  sessionId: number;
}

const drafts = new Map<string, ChatInputDraft>();
let nextSessionId = 0;

export function openChatInputDraft(rootPath: string): ChatInputDraftSession {
  const draft = drafts.get(rootPath) ?? { content: '', revision: 0, sessionId: 0 };
  const sessionId = ++nextSessionId;
  drafts.set(rootPath, { ...draft, sessionId });
  return { content: draft.content, revision: draft.revision, sessionId };
}

export function updateChatInputDraft(rootPath: string, sessionId: number, content: string): number {
  const draft = drafts.get(rootPath);
  if (!draft || draft.sessionId !== sessionId) return -1;
  const revision = draft.revision + 1;
  drafts.set(rootPath, { content, revision, sessionId });
  return revision;
}

export function clearChatInputDraft(
  rootPath: string,
  sessionId: number,
  revision: number
): number | null {
  const draft = drafts.get(rootPath);
  if (!draft || draft.sessionId !== sessionId || draft.revision !== revision) return null;
  const nextRevision = revision + 1;
  drafts.set(rootPath, { content: '', revision: nextRevision, sessionId });
  return nextRevision;
}
