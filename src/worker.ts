/// <reference lib="webworker" />
import { IngestError } from './core/ingest';
import type { EvaluationReport, Progress } from './core/types';
import { runPayload } from './runPayload';
import type { InputPayload } from './runPayload';

export type WorkerRequest = { type: 'run'; inputs: InputPayload[] };
export type WorkerResponse =
  | { type: 'progress'; progress: Progress }
  | { type: 'done'; report: EvaluationReport }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type !== 'run') return;
  try {
    const report = runPayload(e.data.inputs, (progress) => ctx.postMessage({ type: 'progress', progress } satisfies WorkerResponse));
    ctx.postMessage({ type: 'done', report } satisfies WorkerResponse);
  } catch (err) {
    const message = err instanceof IngestError ? err.message : `Something went wrong while reading that: ${(err as Error).message}`;
    ctx.postMessage({ type: 'error', message } satisfies WorkerResponse);
  }
};
