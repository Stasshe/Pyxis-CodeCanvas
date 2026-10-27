export interface StartupProgress {
  detail: string;
  completed?: number;
  total?: number;
}

export interface StartupContext {
  signal: AbortSignal;
  report: (progress: StartupProgress) => void;
}

/** Bound inactivity, rather than total duration, so large imports can keep making progress. */
export async function runStartupStage<T>(
  stage: string,
  operation: (context: StartupContext) => Promise<T>,
  onProgress: (stage: string, progress: StartupProgress) => void,
  idleTimeoutMs = 60_000
): Promise<T> {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let lastDetail = stage;
  let fail: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  const report = (progress: StartupProgress): void => {
    controller.signal.throwIfAborted();
    lastDetail = progress.detail;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const error = new Error(
        `${stage} timed out after ${idleTimeoutMs / 1000}s without progress: ${lastDetail}`
      );
      controller.abort(error);
      fail(error);
    }, idleTimeoutMs);
    onProgress(stage, progress);
  };
  report({ detail: stage });
  console.info(`[Startup] ${stage}: started`);
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => operation({ signal: controller.signal, report })),
      deadline,
    ]);
    console.info(`[Startup] ${stage}: completed in ${Math.round(performance.now() - startedAt)}ms`);
    return result;
  } catch (error) {
    controller.abort(error);
    console.error(
      `[Startup] ${stage}: failed after ${Math.round(performance.now() - startedAt)}ms (${lastDetail})`,
      error
    );
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}
