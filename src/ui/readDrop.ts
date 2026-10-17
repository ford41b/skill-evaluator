import type { InputItem } from '../client';
import { IGNORED_DIRS, IGNORED_FILES, MAX_FILES } from '../core/limits';

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

export class TooManyFiles extends Error {}

const readAll = (reader: ReturnType<NonNullable<FsEntry['createReader']>>): Promise<FsEntry[]> =>
  new Promise((resolve, reject) => {
    const acc: FsEntry[] = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) resolve(acc);
      else {
        acc.push(...batch);
        next();
      }
    }, reject);
    next();
  });

const fileOf = (e: FsEntry): Promise<File> => new Promise((ok, err) => e.file!(ok, err));

function classify(path: string, file: File): InputItem {
  if (!path.includes('/') && /\.zip$/i.test(file.name)) return { kind: 'zip', name: file.name, source: file };
  return { kind: 'file', path, source: file };
}

/** Walk a dropped folder, skipping junk directories early (node_modules, .git, …). */
async function walk(entry: FsEntry, out: InputItem[]): Promise<void> {
  if (out.length > MAX_FILES) throw new TooManyFiles();
  if (entry.isFile) {
    if (IGNORED_FILES.has(entry.name)) return;
    const path = entry.fullPath.replace(/^\/+/, '');
    out.push(classify(path, await fileOf(entry)));
  } else if (entry.isDirectory && !IGNORED_DIRS.has(entry.name)) {
    const children = await readAll(entry.createReader!());
    for (const c of children) await walk(c, out);
  }
}

/** Read everything from a drop event (folders, zips, loose files). */
export async function readDataTransfer(dt: DataTransfer): Promise<InputItem[]> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const e = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (e) entries.push(e); // must be collected synchronously: items expire after the event
  }
  const out: InputItem[] = [];
  if (entries.length) {
    for (const e of entries) await walk(e, out);
    return out;
  }
  for (const f of Array.from(dt.files)) out.push(classify(f.name, f));
  return out;
}

/** Read files chosen via <input type=file> (optionally with webkitdirectory). */
export function readFileList(list: FileList): InputItem[] {
  const out: InputItem[] = [];
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/');
    if (parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p)) || IGNORED_FILES.has(f.name)) continue;
    out.push(classify(rel, f));
  }
  if (out.length > MAX_FILES) throw new TooManyFiles();
  return out;
}
