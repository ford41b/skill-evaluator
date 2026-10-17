import { parseManifest } from './frontmatter';
import {
  DEDUP_MIN_CHUNK_CHARS, DEDUP_THRESHOLD, DEDUP_TRIVIAL_MAX_CHARS, MAX_DEDUP_CHUNKS, SIMILARITY_HIGH, SIMILARITY_MEDIUM,
} from './limits';
import { buildTfIdf, cosine, normalizeForCompare } from './text';
import type { DuplicatePair, Severity, SkillOverlap, SkillPackage, Tier2Result, TierStatus } from './types';
import { clip, ext, findManifest, isExcludedPath } from './util';
import { Collector } from './validators/ctx';

interface Chunk { path: string; startLine: number; endLine: number; text: string }

const DEDUP_EXT = new Set(['.md', '.mdc', '.py', '.sh']);

/** Split a file into paragraph-sized blocks; fenced code stays in one block. */
function chunkFile(path: string, text: string, bodyOffset: number): Chunk[] {
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  let cur: string[] = [];
  let start = bodyOffset + 1;
  let inFence = false;
  const flush = (endLine: number) => {
    const t = cur.join('\n').trim();
    if (t.length >= DEDUP_MIN_CHUNK_CHARS) chunks.push({ path, startLine: start, endLine, text: t });
    cur = [];
  };
  for (let i = bodyOffset; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s{0,3}(```|~~~)/.test(ln)) inFence = !inFence;
    if (!inFence && ln.trim() === '') {
      if (cur.length) flush(i);
      start = i + 2;
    } else {
      if (!cur.length) start = i + 1;
      cur.push(ln);
    }
  }
  if (cur.length) flush(lines.length);
  return chunks;
}

export function collectChunks(pkg: SkillPackage): Chunk[] {
  const out: Chunk[] = [];
  for (const f of pkg.files) {
    if (f.text === null || !DEDUP_EXT.has(ext(f.path)) || isExcludedPath(f.path)) continue;
    let offset = 0;
    if (f.path.toLowerCase() === 'skill.md') {
      const fm = parseManifest(f.text);
      offset = fm.hasFrontmatter ? fm.bodyStartLine - 1 : 0;
    }
    out.push(...chunkFile(f.path, f.text, offset));
  }
  return out.slice(0, MAX_DEDUP_CHUNKS);
}

function dupSeverity(sim: number, a: Chunk, b: Chunk): Severity {
  const small = Math.max(a.text.length, b.text.length) < DEDUP_TRIVIAL_MAX_CHARS;
  if (small) return 'low';
  if (sim >= 0.95) return 'high';
  if (sim >= 0.9) return 'medium';
  return 'low';
}

export function emptyTier2(): Tier2Result {
  return { findings: [], passes: [], duplicates: [], overlaps: [], chunksAnalyzed: 0, interSkillRan: false, status: 'pass' };
}

export function statusFromFindings(findings: { severity: Severity }[]): TierStatus {
  if (findings.some((f) => f.severity === 'critical' || f.severity === 'high')) return 'fail';
  if (findings.some((f) => f.severity === 'medium' || f.severity === 'low')) return 'warn';
  return 'pass';
}

/** Repeated content inside one skill (lexical TF-IDF similarity; no embeddings offline). */
export function intraSkillDedup(pkg: SkillPackage): Tier2Result {
  const C = 'DEDUP';
  const col = new Collector(2);
  const res = emptyTier2();
  const chunks = collectChunks(pkg);
  res.chunksAnalyzed = chunks.length;
  if (chunks.length < 2) {
    col.pass(C, 'content_dedup', chunks.length ? 'Only one content block — nothing to compare' : 'No content blocks to compare');
  } else {
    const model = buildTfIdf(chunks.map((c) => c.text));
    const norm = chunks.map((c) => normalizeForCompare(c.text));
    const pairs: DuplicatePair[] = [];
    for (let i = 0; i < chunks.length; i++) {
      for (let j = i + 1; j < chunks.length; j++) {
        const sim = norm[i] === norm[j] ? 1 : cosine(model, i, j);
        if (sim >= DEDUP_THRESHOLD) {
          const a = chunks[i], b = chunks[j];
          pairs.push({ a: { ...a }, b: { ...b }, similarity: sim });
        }
      }
    }
    pairs.sort((x, y) => y.similarity - x.similarity);
    res.duplicates = pairs.slice(0, 50);
    for (const p of pairs.slice(0, 25)) {
      const sev = dupSeverity(p.similarity, p.a as Chunk, p.b as Chunk);
      const same = p.a.path === p.b.path;
      col.add(C, 'content_duplication', sev,
        `${Math.round(p.similarity * 100)}% similar content ${same ? `within ${p.a.path}` : `between ${p.a.path} and ${p.b.path}`}`, {
          filePath: p.a.path, line: p.a.startLine, snippet: clip(p.a.text.split('\n')[0], 160),
          suggestion: 'Keep one copy and point to it (link to a references/ file) so the agent loads the guidance once.',
          data: { other: { path: p.b.path, line: p.b.startLine }, similarity: p.similarity },
        });
    }
    if (pairs.length > 25) col.add(C, 'content_duplication', 'info', `${pairs.length - 25} more similar pairs not shown`);
    if (!pairs.length) col.pass(C, 'content_dedup', `No repeated content across ${chunks.length} blocks`);
  }
  res.findings = col.findings;
  res.passes = col.passes;
  res.status = statusFromFindings(res.findings);
  return res;
}

export interface SkillDoc { pkg: SkillPackage; name: string; desc: string; body: string }

export function skillDoc(pkg: SkillPackage): SkillDoc {
  const m = findManifest(pkg);
  const fm = m?.text ? parseManifest(m.text) : null;
  return {
    pkg,
    name: String(fm?.data?.['name'] ?? pkg.dirName),
    desc: String(fm?.data?.['description'] ?? ''),
    body: fm ? fm.body : m?.text ?? '',
  };
}

/** Compare every dropped skill against the others (stands in for NVIDIA's --catalog option). */
export function interSkillOverlap(pkgs: SkillPackage[], results: Tier2Result[]): void {
  if (pkgs.length < 2) return;
  const docs = pkgs.map(skillDoc);
  const descModel = buildTfIdf(docs.map((d) => `${d.name.replace(/-/g, ' ')} ${d.desc}`));
  const bodyModel = buildTfIdf(docs.map((d) => d.body));
  for (let i = 0; i < docs.length; i++) {
    const col = new Collector(2);
    const overlaps: SkillOverlap[] = [];
    for (let j = 0; j < docs.length; j++) {
      if (i === j) continue;
      const collision = docs[i].name === docs[j].name;
      const sim = Math.max(cosine(descModel, i, j), cosine(bodyModel, i, j));
      if (collision || sim >= 0.5) overlaps.push({ other: docs[j].name === docs[i].name ? `${docs[j].name} (${pkgs[j].dirName})` : docs[j].name, similarity: sim, nameCollision: collision });
      if (collision) {
        col.add('DEDUP', 'name_collision', 'high', `Another skill in this set is also named '${docs[i].name}'`, {
          filePath: 'SKILL.md', suggestion: 'Skill names must be unique, or agents cannot tell them apart.',
        });
      }
      if (sim >= SIMILARITY_MEDIUM) {
        const sev: Severity = sim >= 0.95 ? 'critical' : sim >= SIMILARITY_HIGH ? 'high' : 'medium';
        col.add('DEDUP', 'skill_overlap', sev, `${Math.round(sim * 100)}% similar to skill '${docs[j].name}'`, {
          filePath: 'SKILL.md',
          suggestion: sim >= 0.9 ? 'These look like duplicates — merge them or clearly separate their purposes.' : 'Sharpen both descriptions so agents pick the right skill ("Use for X; not for Y").',
          data: { other: docs[j].name, similarity: sim },
        });
      }
    }
    overlaps.sort((a, b) => b.similarity - a.similarity);
    results[i].overlaps = overlaps;
    results[i].interSkillRan = true;
    results[i].findings.push(...col.findings);
    if (!col.findings.length) results[i].passes.push({ category: 'DEDUP', checkName: 'skill_overlap', message: `No significant overlap with ${docs.length - 1} other skill(s)` });
    results[i].status = statusFromFindings(results[i].findings);
  }
}
