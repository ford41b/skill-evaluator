import { SCAN_EXCLUDED_DIRS, SCAN_EXCLUDED_FILES, SCANNABLE_TEXT_EXT } from './limits';
import type { SkillFile, SkillPackage } from './types';

export function ext(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function topDir(path: string): string {
  const i = path.indexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

/** 1-based line number of a string index. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function lineText(text: string, line: number): string {
  const lines = text.split('\n');
  return (lines[line - 1] ?? '').replace(/\r$/, '');
}

export function clip(s: string, max = 200): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function isExcludedPath(path: string): boolean {
  const parts = path.split('/');
  if (parts.slice(0, -1).some((p) => SCAN_EXCLUDED_DIRS.has(p))) return true;
  return SCAN_EXCLUDED_FILES.has(parts[parts.length - 1]);
}

/** Text files Tier 1 content scanners should read. */
export function scannableFiles(pkg: SkillPackage, extensions: Set<string> = SCANNABLE_TEXT_EXT): SkillFile[] {
  return pkg.files.filter((f) => f.text !== null && extensions.has(ext(f.path)) && !isExcludedPath(f.path));
}

export function getFile(pkg: SkillPackage, path: string): SkillFile | undefined {
  const lower = path.toLowerCase();
  return pkg.files.find((f) => f.path.toLowerCase() === lower);
}

export function findManifest(pkg: SkillPackage): SkillFile | undefined {
  return pkg.files.find((f) => f.path.toLowerCase() === 'skill.md');
}

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Contains a term as a whole word (not inside another word). */
export function containsTerm(text: string, term: string): boolean {
  const esc = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, 'i').test(text);
}

export function containsAny(text: string, terms: string[]): boolean {
  return terms.some((t) => containsTerm(text, t));
}

export const XML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9_-]*(?:\s[^<>]*)?\/?>|<\/?[A-Za-z][A-Za-z0-9_-]*\s[^<>]*$/;

/**
 * Markdown link/image targets, ignoring fenced and inline code.
 * Returns raw hrefs in source order with their line numbers.
 */
export function markdownLinks(text: string): { href: string; line: number }[] {
  const out: { href: string; line: number }[] = [];
  const lines = text.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (m) {
      if (fence === null) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const line = raw.replace(/`[^`]*`/g, '');
    const inline = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+["'][^)]*["'])?\s*\)/g;
    let mm: RegExpExecArray | null;
    while ((mm = inline.exec(line))) out.push({ href: mm[1].replace(/^<|>$/g, ''), line: i + 1 });
    const ref = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/.exec(line);
    if (ref) out.push({ href: ref[1].replace(/^<|>$/g, ''), line: i + 1 });
  }
  return out;
}

/**
 * Resolve a relative href against the containing file. Returns
 * undefined for external/anchor-only links, null when the path is invalid
 * (absolute, or escapes the skill root).
 */
export function resolveLocalLink(fromFile: string, href: string): string | undefined | null {
  const h = href.trim();
  if (!h || h.startsWith('#')) return undefined;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(h) && !/^[a-zA-Z]:[\\/]/.test(h)) return undefined; // http:, mailto:, etc.
  if (h.startsWith('//')) return undefined;
  if (h.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(h)) return null;
  let p = h.split('#')[0].split('?')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  p = p.replace(/\\/g, '/');
  if (!p) return undefined;
  const parts = dirname(fromFile) ? dirname(fromFile).split('/') : [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

export function luhn(digits: string): boolean {
  const d = digits.replace(/\D/g, '');
  if (d.length < 13) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
