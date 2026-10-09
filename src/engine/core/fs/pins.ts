interface RootPin {
  count: number;
  completed: Promise<void>;
  release: () => void;
}

/** Reference counts protect service root identity without extending namespace leases. */
export class RootPins {
  private readonly pins = new Map<string, RootPin>();

  acquire(paths: Set<string>): () => void {
    for (const path of paths) {
      let pin = this.pins.get(path);
      if (!pin) {
        let release!: () => void;
        const completed = new Promise<void>(resolve => {
          release = resolve;
        });
        pin = { count: 0, completed, release };
        this.pins.set(path, pin);
      }
      pin.count += 1;
    }
    return () => {
      for (const path of paths) {
        const pin = this.pins.get(path);
        if (!pin) throw new Error(`Missing filesystem root pin: ${path}`);
        pin.count -= 1;
        if (pin.count === 0) {
          this.pins.delete(path);
          pin.release();
        }
      }
    };
  }

  blockers(paths: string[]): Promise<void>[] {
    const waiting: Promise<void>[] = [];
    for (const [root, pin] of this.pins) {
      if (paths.some(path => path === '/' || path === root || root.startsWith(`${path}/`))) {
        waiting.push(pin.completed);
      }
    }
    return waiting;
  }
}
