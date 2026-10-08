export class NpmNetwork {
  private activeRequests = 0;
  private readonly waitingRequests: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error('Network request limit must be positive');
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.activeRequests < this.limit) {
      this.activeRequests += 1;
      return;
    }
    await new Promise<void>(resolve => this.waitingRequests.push(resolve));
  }

  private release(): void {
    const next = this.waitingRequests.shift();
    if (next) next();
    else this.activeRequests -= 1;
  }
}

export const NPM_NETWORK_CONCURRENCY = 6;
export const npmNetwork = new NpmNetwork(NPM_NETWORK_CONCURRENCY);
