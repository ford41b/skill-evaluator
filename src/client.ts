import type { EvaluationReport, Progress } from './core/types';
import type { InputPayload } from './runPayload';
import type { WorkerResponse } from './worker';

export type InputItem =
  | { kind: 'file'; path: string; source: File | Uint8Array }
  | { kind: 'zip'; name: string; source: File | Uint8Array };

async function toBuffer(src: File | Uint8Array): Promise<ArrayBuffer> {
  if (src instanceof Uint8Array) return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength) as ArrayBuffer;
  return src.arrayBuffer();
}

async function toPayload(items: InputItem[]): Promise<InputPayload[]> {
  return Promise.all(items.map(async (i): Promise<InputPayload> => (i.kind === 'file'
    ? { kind: 'file', path: i.path, data: await toBuffer(i.source) }
    : { kind: 'zip', name: i.name, data: await toBuffer(i.source) })));
}

/** Evaluate in a Web Worker so big skills never freeze the page; falls back to the main thread. */
export async function runEvaluation(items: InputItem[], onProgress: (p: Progress) => void): Promise<EvaluationReport> {
  const inputs = await toPayload(items);
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (!worker) {
    const { runPayload } = await import('./runPayload');
    return runPayload(inputs, onProgress);
  }
  const w = worker;
  return new Promise<EvaluationReport>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.progress);
      else {
        w.terminate();
        if (m.type === 'done') resolve(m.report);
        else reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'The evaluator crashed.'));
    };
    w.postMessage({ type: 'run', inputs }, inputs.map((i) => i.data));
  });
}
