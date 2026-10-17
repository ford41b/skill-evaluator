import { discoverSkills } from '../src/core/ingest';
import { evaluateSkills } from '../src/core/evaluate';
import type { RawFile } from '../src/core/types';

const enc = new TextEncoder();
export const raw = (files: Record<string, string>): RawFile[] => Object.entries(files).map(([path, text]) => ({ path, data: enc.encode(text) }));

export function evalFiles(files: Record<string, string>) {
  return evaluateSkills(discoverSkills(raw(files)));
}

export const GOOD_SKILL = `---
name: pdf-extractor
description: Extracts text and tables from PDF files. Use when the user asks to read, summarize or pull data out of a PDF document. Do not use for scanned images.
license: Apache-2.0
metadata:
  author: Jane Doe <jane@example.com>
  tags: [pdf, documents]
  version: 1.0.0
---

# PDF Extractor

## Purpose

Pull text and tables out of PDF files so they can be summarized or analyzed.

## Prerequisites

- Python 3.10+

## Instructions

1. Run \`python scripts/extract.py <file.pdf>\` to extract the text.
2. Check the output for errors and report failures to the user.
3. Use the \`--tables\` flag when the user needs table data.

## Examples

\`\`\`bash
python scripts/extract.py report.pdf
python scripts/extract.py report.pdf --tables
\`\`\`

## Available Scripts

| Script | Purpose | Arguments |
| --- | --- | --- |
| extract.py | Extract text | file path |

## Limitations

- Scanned PDFs need OCR first.

## Troubleshooting

| Error | Fix |
| --- | --- |
| File not found | Check the path |
`;
