export interface AIRequestIdentity {
  rootPath: string | null;
  spaceId: string | null;
  generation: number;
}

export function updateAIRequestIdentity(
  previous: AIRequestIdentity,
  rootPath: string | null,
  spaceId: string | null
): AIRequestIdentity {
  if (previous.rootPath === rootPath && previous.spaceId === spaceId) return previous;
  return { rootPath, spaceId, generation: previous.generation + 1 };
}

export function isAIRequestIdentityCurrent(
  request: AIRequestIdentity,
  active: AIRequestIdentity
): boolean {
  return (
    active.rootPath === request.rootPath &&
    active.spaceId === request.spaceId &&
    active.generation === request.generation
  );
}
