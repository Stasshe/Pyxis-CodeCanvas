export interface CanonicalCommandState {
  queued: boolean;
  cancelled: boolean;
}

export type CanonicalCommandAction = 'empty' | 'cancel' | 'run';

export function resolveCanonicalCommand(
  state: CanonicalCommandState,
  command: string
): CanonicalCommandAction {
  if (!command.trim()) {
    state.queued = false;
    state.cancelled = false;
    return 'empty';
  }

  let action: CanonicalCommandAction = 'run';
  if (state.cancelled) action = 'cancel';
  state.queued = false;
  state.cancelled = false;
  return action;
}

export function clearCanonicalCommandState(state: CanonicalCommandState): void {
  state.queued = false;
  state.cancelled = false;
}
