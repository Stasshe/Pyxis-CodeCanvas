import type { FsApi } from '@/engine/core/fs/index';
import type { ShellOutputHandler } from './outputHandler';
import type { Process } from './process';
import { closeExpansionResources, closeExpansionResourcesOnExit } from './processSubstitution';
import type { OutputCallbacks, Segment } from './types';
import {
  type ExpansionResources,
  expandProcessSegment,
  type ShellExpansionContext,
  type WordExpansionShell,
} from './wordExpansion';

export async function expandProcessSegmentForShell(
  segment: Segment,
  process: Process,
  context: ShellExpansionContext,
  shell: WordExpansionShell,
  fsClient: FsApi,
  outputHandler: Pick<ShellOutputHandler, 'releaseFifoOwner'>,
  callbacks?: OutputCallbacks
): Promise<void> {
  const resources: ExpansionResources = {
    fifoOwners: [],
    cancelChildren: [],
    processSubstitutionCallbacks: callbacks,
  };
  try {
    await expandProcessSegment(
      segment,
      context,
      shell,
      {
        stderr: message => process.writeStderr(message),
      },
      resources
    );
  } catch (error) {
    try {
      await closeExpansionResources(
        resources,
        fsClient,
        path => outputHandler.releaseFifoOwner(path),
        true
      );
    } finally {
      process.exit(1);
    }
    throw error;
  }
  closeExpansionResourcesOnExit(process, resources, fsClient, path =>
    outputHandler.releaseFifoOwner(path)
  );
}
