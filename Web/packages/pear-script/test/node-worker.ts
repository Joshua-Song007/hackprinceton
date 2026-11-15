// Test-only: runs evaluate.ts in a real Node worker thread with the same wiring as src/worker.ts.
import { parentPort } from 'node:worker_threads';
import { attachWorker } from '../src/evaluate.ts';

const port = parentPort;
const scope = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: (m: unknown) => port?.postMessage(m) };
port?.on('message', (data) => scope.onmessage?.({ data }));
attachWorker(scope);
