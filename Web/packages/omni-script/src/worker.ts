// Web Worker entry: all logic lives in evaluate.ts so it can be tested in Node.
import { attachWorker, type WorkerScope } from './evaluate';

attachWorker(self as unknown as WorkerScope);
