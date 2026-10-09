export class TerminalTypeahead {
  private pending: string[] = [];
  private active = false;
  private disposed = false;

  constructor(
    private readonly isBlocked: () => boolean,
    private readonly hasActiveReader: () => boolean,
    private readonly isProcessingCommand: () => boolean
  ) {}

  private isReady(): boolean {
    if (this.isBlocked()) return false;
    if (this.hasActiveReader()) return true;
    return !this.isProcessingCommand();
  }

  get isActive(): boolean {
    return this.active && !this.disposed;
  }

  begin(): void {
    if (this.disposed || this.active) return;
    this.pending = [];
    this.active = true;
  }

  enqueue(data: string): void {
    if (!this.isActive) return;
    const signalIndex = data.lastIndexOf('\x03');
    if (signalIndex >= 0) {
      this.pending = [];
      this.pending.push('\x03');
      const afterSignal = data.slice(signalIndex + 1);
      if (afterSignal) this.pending.push(afterSignal);
      return;
    }
    this.pending.push(data);
  }

  route(data: string, deliver: (data: string) => void): void {
    if (this.disposed) return;
    if (!this.isActive) {
      deliver(data);
      return;
    }
    this.enqueue(data);
    this.drain(deliver);
  }

  drain(deliver: (data: string) => void): void {
    if (!this.isActive || !this.isReady()) return;
    while (this.pending.length > 0 && this.isReady()) {
      const next = this.pending.shift();
      if (next !== undefined) deliver(next);
    }
    if (this.pending.length === 0 && this.isReady()) this.active = false;
  }

  dispose(): void {
    this.disposed = true;
    this.active = false;
    this.pending = [];
  }
}
