import type { Severity, SkillPackage } from '../types';
import { clip, lineAt, lineText, scannableFiles } from '../util';
import type { Collector } from './ctx';

const SCAN_EXT = new Set(['.md', '.mdc', '.py', '.sh', '.yaml', '.yml', '.json', '.txt', '.js', '.ts', '.html']);

interface Cat { id: string; desc: string; severity: Severity }

const ZERO_WIDTH = new Set([0x034f, 0x180e, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const BIDI = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
const INVISIBLE_OPS = new Set([0x2061, 0x2062, 0x2063, 0x2064]);
const DEPRECATED = new Set([0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f]);

function categorize(cp: number): Cat | null {
  if (cp >= 0xe0000 && cp <= 0xe007f) return { id: 'unicode_tags', desc: 'Unicode Tag characters (hidden ASCII)', severity: 'critical' };
  if (BIDI.has(cp)) return { id: 'bidi_marks', desc: 'Bidirectional override characters (trojan source)', severity: 'high' };
  if (ZERO_WIDTH.has(cp)) return { id: 'zero_width', desc: 'Zero-width characters', severity: 'medium' };
  if (INVISIBLE_OPS.has(cp)) return { id: 'invisible_operators', desc: 'Invisible math operators', severity: 'medium' };
  if (DEPRECATED.has(cp)) return { id: 'deprecated_format_controls', desc: 'Deprecated format control characters', severity: 'medium' };
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)) return { id: 'variation_selectors', desc: 'Variation selectors', severity: 'low' };
  return null;
}

function isEmojiish(cp: number | undefined): boolean {
  if (cp === undefined) return false;
  return (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2190 && cp <= 0x2bff) || cp === 0x2122 || cp === 0x00a9 || cp === 0x00ae || (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a;
}

const ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
const maxSev = (a: Severity, b: Severity) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

/** Detects invisible Unicode used for ASCII smuggling and trojan-source attacks. */
export function validateUnicode(pkg: SkillPackage, c: Collector): void {
  const C = 'UNICODE';
  const files = scannableFiles(pkg, SCAN_EXT);
  let found = 0;
  for (const f of files) {
    const text = f.text!;
    const cps = Array.from(text);
    let idx = 0; // UTF-16 index tracking
    let prev: number | undefined;
    let reported = 0;
    let i = 0;
    while (i < cps.length) {
      const cp = cps[i].codePointAt(0)!;
      const cat = categorize(cp);
      if (!cat || (cp === 0xfeff && i === 0)) {
        prev = cp;
        idx += cps[i].length;
        i++;
        continue;
      }
      // Benign: emoji presentation selectors and ZWJ sequences.
      if ((cp === 0xfe0f || cp === 0xfe0e) && prev !== undefined && prev > 0x7f) { prev = cp; idx += cps[i].length; i++; continue; }
      if (cp === 0x200d && (isEmojiish(prev) || isEmojiish(cps[i + 1]?.codePointAt(0)))) { prev = cp; idx += cps[i].length; i++; continue; }
      // Gather a consecutive run of hidden characters.
      const start = idx;
      let run = 0;
      let severity = cat.severity;
      const categories = new Set<string>();
      const hidden: number[] = [];
      let j = i;
      let jIdx = idx;
      while (j < cps.length) {
        const cj = cps[j].codePointAt(0)!;
        const cc = categorize(cj);
        if (!cc) break;
        run++;
        categories.add(cc.id);
        severity = maxSev(severity, cc.severity);
        if (cj >= 0xe0020 && cj <= 0xe007e) hidden.push(cj - 0xe0000);
        jIdx += cps[j].length;
        j++;
      }
      if (run >= 40) severity = 'critical';
      else if (run >= 10) severity = maxSev(severity, 'high');
      const line = lineAt(text, start);
      const decoded = hidden.length ? String.fromCharCode(...hidden) : '';
      if (reported < 20) {
        found++;
        reported++;
        const what = [...categories].join(', ');
        c.add(C, 'unicode_smuggling', severity,
          `${run} invisible character${run > 1 ? 's' : ''} (${what}) at ${f.path}:${line}${decoded ? ` — hidden text decodes to: "${clip(decoded, 120)}"` : ''}`,
          {
            filePath: f.path, line, snippet: clip(lineText(text, line).replace(/[\u{e0000}-\u{e007f}​-‏‪-‮⁠-⁯︀-️﻿]/gu, (ch) => `⟦U+${ch.codePointAt(0)!.toString(16).toUpperCase()}⟧`), 200),
            suggestion: 'Delete these characters. Invisible text can carry instructions that humans cannot see but agents will read.',
          });
      }
      prev = cps[j - 1].codePointAt(0);
      idx = jIdx;
      i = j;
    }
  }
  if (!found) c.pass(C, 'unicode_smuggling', `No hidden Unicode characters in ${files.length} file(s)`);
}
