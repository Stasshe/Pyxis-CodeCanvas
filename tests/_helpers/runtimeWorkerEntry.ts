import { parentPort } from 'node:worker_threads';
import type { MainMessage, WorkerMessage } from '@/engine/system/runtime/nodejs/workerProtocol';

const port = parentPort;
if (!port) throw new Error('Runtime worker requires a parent port.');

const events = new EventTarget();
Object.defineProperty(globalThis, 'self', {
  configurable: true,
  value: {
    addEventListener: events.addEventListener.bind(events),
    postMessage(message: WorkerMessage) {
      port.postMessage(message);
    },
  },
});
port.on('message', (data: MainMessage) => {
  events.dispatchEvent(new MessageEvent('message', { data }));
});

void import('@/engine/system/runtime/nodejs/runtimeWorker');
