type InputHandler = (prompt: string) => Promise<string>;

interface QueuedRequest {
  prompt: string;
  resolve: (line: string) => void;
  reject: (err: any) => void;
}

class TerminalInputBridge {
  private handler: InputHandler | null = null;
  private queue: QueuedRequest[] = [];
  private busy = false;

  registerHandler(handler: InputHandler): void {
    this.handler = handler;
  }

  unregisterHandler(): void {
    this.handler = null;
    // Flush pending queue with empty strings on unregister
    for (const req of this.queue) {
      req.resolve('');
    }
    this.queue = [];
    this.busy = false;
  }

  requestInput(prompt: string): Promise<string> {
    if (!this.handler) return Promise.resolve('');

    return new Promise<string>((resolve, reject) => {
      this.queue.push({ prompt, resolve, reject });
      if (!this.busy) this.processNext();
    });
  }

  private processNext(): void {
    if (!this.handler || this.queue.length === 0) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const req = this.queue.shift()!;
    this.handler(req.prompt)
      .then(line => {
        req.resolve(line);
        this.processNext();
      })
      .catch(err => {
        req.reject(err);
        this.processNext();
      });
  }
}

export const terminalInputBridge = new TerminalInputBridge();
