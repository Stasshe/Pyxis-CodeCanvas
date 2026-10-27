import { configureAppCommandHandlers } from '@/engine/system/shell/commandDispatch';

export function initializeAppCommands(): void {
  configureAppCommandHandlers({
    async pyxis(...args) {
      const { handlePyxisCommand } = await import('./pyxisHandler');
      await handlePyxisCommand(...args);
    },
    async dev(...args) {
      const { handleDevCommand } = await import('./devHandler');
      await handleDevCommand(...args);
    },
  });
}
