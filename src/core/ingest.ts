import { unzipSync } from 'fflate';
import {
  IGNORED_DIRS, IGNORED_FILES, MAX_FILES, MAX_SKILLS, MAX_TEXT_FILE_BYTES, MAX_TOTAL_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES,
} from './limits';
import type { RawFile, SkillFile, SkillPackage } from './types';
import { basename, dirname } from './util';

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip', '.gz', '.tar', '.7z', '.woff', '.woff2', '.ttf', '.otf',
  '.pptx', '.potx', '.docx', '.xlsx', '.mp3', '.mp4', '.mov', '.wasm', '.pyc', '.so', '.dll', '.exe', '.bin', '.lock',
]);

export class IngestError extends Error {}

export function normalizePath(p: string): string | null {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null; // never allow escaping the dropped root
    parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

function shouldIgnore(path: string): boolean {
  const parts = path.split('/');
  if (parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p))) return true;
  return IGNORED_FILES.has(parts[parts.length - 1]) || parts[parts.length - 1].startsWith('._');
}

/** Extract a zip into raw files (in memory), with zip-bomb limits. */
export function unzipToRaw(bytes: Uint8Array, zipName: string): RawFile[] {
  let entries = 0;
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(info) {
        entries++;
        if (entries > MAX_ZIP_ENTRIES) throw new IngestError(`Zip has more than ${MAX_ZIP_ENTRIES} entries.`);
        if (info.name.endsWith('/')) return false;
        if (info.originalSize > MAX_ZIP_ENTRY_BYTES) throw new IngestError(`"${info.name}" in ${zipName} is too large to open here.`);
        total += info.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new IngestError(`${zipName} expands to more than ${MAX_TOTAL_BYTES / 1048576} MB.`);
        const p = normalizePath(info.name);
        return p !== null && !shouldIgnore(p);
      },
    });
  } catch (e) {
    if (e instanceof IngestError) throw e;
    throw new IngestError(`Could not read ${zipName} as a zip file.`);
  }
  const out: RawFile[] = [];
  for (const [name, data] of Object.entries(files)) {
    const p = normalizePath(name);
    if (p) out.push({ path: p, data });
  }
  return out;
}

function isBinary(path: string, data: Uint8Array): boolean {
  const dot = path.lastIndexOf('.');
  if (dot > 0 && BINARY_EXT.has(path.slice(dot).toLowerCase())) return true;
  const n = Math.min(data.length, 8192);
  for (let i = 0; i < n; i++) if (data[i] === 0) return true;
  return false;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

function toSkillFile(path: string, data: Uint8Array): SkillFile {
  const binary = isBinary(path, data);
  if (binary) return { path, size: data.length, text: null, binary: true };
  if (data.length > MAX_TEXT_FILE_BYTES) return { path, size: data.length, text: null, binary: false };
  return { path, size: data.length, text: decoder.decode(data), binary: false };
}

/**
 * Turn dropped files into skill packages: every directory containing a
 * SKILL.md is a skill root. If nothing is a skill, returns [].
 */
export function discoverSkills(raw: RawFile[], fallbackName = 'skill'): SkillPackage[] {
  const files = raw
    .map((f) => ({ path: normalizePath(f.path), data: f.data }))
    .filter((f): f is RawFile => f.path !== null && !shouldIgnore(f.path));

  if (files.length > MAX_FILES) throw new IngestError(`That's ${files.length} files — the limit is ${MAX_FILES}. Drop a single skill folder instead.`);
  const total = files.reduce((s, f) => s + f.data.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new IngestError(`That's over ${MAX_TOTAL_BYTES / 1048576} MB. Drop a single skill folder instead.`);

  // Strip a shared top-level wrapper only when files come from one folder drop with no manifest at root.
  const roots = new Set<string>();
  for (const f of files) if (basename(f.path).toLowerCase() === 'skill.md') roots.add(dirname(f.path));
  if (roots.size === 0) return [];
  if (roots.size > MAX_SKILLS) throw new IngestError(`Found ${roots.size} skills — the limit is ${MAX_SKILLS} at once.`);

  const sortedRoots = [...roots].sort((a, b) => b.length - a.length); // deepest first
  const packages = new Map<string, SkillFile[]>();
  for (const r of roots) packages.set(r, []);

  for (const f of files) {
    const owner = sortedRoots.find((r) => r === '' || f.path.startsWith(r + '/'));
    if (owner === undefined) continue;
    const rel = owner === '' ? f.path : f.path.slice(owner.length + 1);
    packages.get(owner)!.push(toSkillFile(rel, f.data));
  }

  const result: SkillPackage[] = [];
  for (const root of [...roots].sort()) {
    const dirName = root === '' ? fallbackName : basename(root);
    const list = packages.get(root)!;
    list.sort((a, b) => Number(b.path.toLowerCase() === 'skill.md') - Number(a.path.toLowerCase() === 'skill.md') || a.path.localeCompare(b.path));
    result.push({ id: root || dirName, dirName, rootPath: root, files: list });
  }
  return result;
}
