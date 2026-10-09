export class LatestRenderQueue<T> {
  private latestState: T | undefined;
  private hasLatestState = false;
  private running: Promise<void> | null = null;

  constructor(
    private readonly render: (state: T) => Promise<void>,
    private readonly onError: (error: unknown) => void
  ) {}

  enqueue(state: T): void {
    this.latestState = state;
    this.hasLatestState = true;
    this.schedule();
  }

  async flush(): Promise<void> {
    while (this.running) await this.running;
  }

  private schedule(): void {
    if (this.running) return;
    this.running = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (this.hasLatestState) {
        const state = this.latestState as T;
        this.hasLatestState = false;
        try {
          await this.render(state);
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.running = null;
      if (this.hasLatestState) this.schedule();
    }
  }
}
