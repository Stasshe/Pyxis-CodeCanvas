import { UnixCommandBase } from './base';

type SignalSubscription = (listener: (signal: string) => void) => () => void;

export class SleepCommand extends UnixCommandBase {
  async execute(
    args: string[],
    onSignal?: SignalSubscription,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (args.length === 0) throw new Error('sleep: missing operand');
    const duration = args.reduce((total, argument) => total + parseDuration(argument), 0);
    if (!Number.isFinite(duration)) throw new Error('sleep: duration is too large');
    if (signal?.aborted) return false;
    if (duration === 0) return true;

    return new Promise(resolve => {
      let remaining = duration;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let removeSignalListener = () => {};
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        removeSignalListener();
        signal?.removeEventListener('abort', abort);
        resolve(completed);
      };
      const abort = () => finish(false);
      const onCommandSignal = (received: string) => {
        if (received === 'SIGINT') finish(false);
      };
      if (onSignal) removeSignalListener = onSignal(onCommandSignal);
      if (settled) {
        removeSignalListener();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });

      const wait = () => {
        const interval = Math.min(remaining, 2_147_000_000);
        timer = setTimeout(() => {
          remaining -= interval;
          if (remaining <= 0) finish(true);
          else wait();
        }, interval);
      };
      wait();
    });
  }
}

function parseDuration(argument: string): number {
  const match = /^((?:\d+(?:\.\d*)?|\.\d+))(s|m|h|d)?$/.exec(argument);
  if (!match) throw new Error(`sleep: invalid time interval: ${argument}`);
  const value = Number(match[1]);
  let multiplier = 1000;
  if (match[2] === 'm') multiplier = 60_000;
  if (match[2] === 'h') multiplier = 3_600_000;
  if (match[2] === 'd') multiplier = 86_400_000;
  return value * multiplier;
}
