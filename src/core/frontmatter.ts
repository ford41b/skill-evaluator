import { parse, YAMLParseError } from 'yaml';

export interface ParsedManifest {
  hasFrontmatter: boolean;
  /** Parsed YAML mapping, or null when absent / invalid / not a mapping. */
  data: Record<string, unknown> | null;
  yamlError?: { message: string; line?: number };
  /** Markdown after the closing --- marker. */
  body: string;
  /** 1-based line of the first body line in the original file. */
  bodyStartLine: number;
  /** Raw frontmatter text. */
  raw: string;
  /** Line numbers (1-based) of top-level frontmatter keys. */
  keyLines: Record<string, number>;
}

const FM_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseManifest(content: string): ParsedManifest {
  const m = FM_RE.exec(content);
  if (!m) {
    return { hasFrontmatter: false, data: null, body: content, bodyStartLine: 1, raw: '', keyLines: {} };
  }
  const raw = m[1];
  const consumed = m[0];
  const bodyStartLine = (consumed.match(/\n/g)?.length ?? 0) + 1;
  const body = content.slice(consumed.length);
  const keyLines: Record<string, number> = {};
  raw.split('\n').forEach((ln, i) => {
    const k = /^([A-Za-z0-9_-]+)\s*:/.exec(ln);
    if (k && !(k[1] in keyLines)) keyLines[k[1]] = i + 2; // line 1 is the opening ---
  });
  try {
    const data = parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { hasFrontmatter: true, data: data as Record<string, unknown>, body, bodyStartLine, raw, keyLines };
    }
    return { hasFrontmatter: true, data: null, body, bodyStartLine, raw, keyLines };
  } catch (e) {
    const err = e as YAMLParseError;
    const line = err.linePos?.[0]?.line;
    return {
      hasFrontmatter: true,
      data: null,
      yamlError: { message: String(err.message ?? e).split('\n')[0], line: line ? line + 1 : undefined },
      body,
      bodyStartLine,
      raw,
      keyLines,
    };
  }
}

export function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}
