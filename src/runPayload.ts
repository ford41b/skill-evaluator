import { evaluateSkills } from './core/evaluate';
import { IngestError, discoverSkills, unzipToRaw } from './core/ingest';
import type { EvaluationReport, Progress, RawFile } from './core/types';

export type InputPayload =
  | { kind: 'file'; path: string; data: ArrayBuffer }
  | { kind: 'zip'; name: string; data: ArrayBuffer };

/** Shared by the worker and the main-thread fallback. */
export function runPayload(inputs: InputPayload[], onProgress: (p: Progress) => void): EvaluationReport {
  const raw: RawFile[] = [];
  const zips = inputs.filter((i) => i.kind === 'zip');
  let fallback = 'skill';
  onProgress({ stage: 'Reading files', done: 0, total: 1 });
  for (const i of inputs) {
    if (i.kind === 'file') raw.push({ path: i.path, data: new Uint8Array(i.data) });
    else {
      const base = i.name.replace(/\.zip$/i, '') || 'skill';
      const files = unzipToRaw(new Uint8Array(i.data), i.name);
      if (zips.length === 1) fallback = base;
      for (const f of files) raw.push({ path: zips.length > 1 ? `${base}/${f.path}` : f.path, data: f.data });
    }
  }
  if (inputs.length === 1 && inputs[0].kind === 'file' && !inputs[0].path.includes('/')) fallback = inputs[0].path.replace(/\.[^.]+$/, '');
  const pkgs = discoverSkills(raw, fallback);
  if (!pkgs.length) {
    throw new IngestError("I couldn't find a SKILL.md in what you dropped. A skill is a folder containing a file named SKILL.md — try dropping that folder (or a zip of it).");
  }
  return evaluateSkills(pkgs, onProgress);
}

