import { parseManifest, str } from '../frontmatter';
import type { SkillPackage } from '../types';
import { basename, ext, findManifest, isExcludedPath } from '../util';
import type { Collector } from './ctx';

const ALLOWED = ['Apache-2.0', 'Apache-1.1', 'Apache-1.0', 'MIT', 'MIT-0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear', '0BSD', 'ISC', 'Unlicense', 'WTFPL', 'Zlib', 'X11', 'JSON', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'PSF-2.0', 'Python-2.0'];
const BLOCKED = ['GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'MPL-2.0', 'EPL-1.0', 'EPL-2.0', 'CC-BY-NC-4.0', 'CC-BY-NC-3.0', 'CC-BY-NC-SA-4.0', 'CC-BY-ND-4.0', 'CC-BY-NC-ND-4.0', 'Proprietary', 'Commercial', 'All-Rights-Reserved', 'Confidential'];

const PATTERNS: { id: string; required: RegExp[]; exclude?: RegExp[] }[] = [
  { id: 'Apache-2.0', required: [/Apache License/i, /Version 2\.0/i] },
  { id: 'MIT', required: [/MIT License|Permission is hereby granted, free of charge/i, /without restriction/i] },
  { id: 'BSD-3-Clause', required: [/BSD/i, /Redistribution and use/i, /Neither the name/i] },
  { id: 'BSD-2-Clause', required: [/BSD|Redistribution and use/i, /Redistribution and use/i], exclude: [/Neither the name/i] },
  { id: 'ISC', required: [/ISC License/i, /Permission to use, copy, modify/i] },
  { id: 'Unlicense', required: [/This is free and unencumbered software/i, /public domain/i] },
  { id: 'CC0-1.0', required: [/CC0|Creative Commons/i, /public domain/i] },
  { id: 'GPL-3.0', required: [/GNU GENERAL PUBLIC LICENSE/, /Version 3/] },
  { id: 'GPL-2.0', required: [/GNU GENERAL PUBLIC LICENSE/, /Version 2/] },
  { id: 'LGPL-3.0', required: [/GNU LESSER GENERAL PUBLIC LICENSE/, /Version 3/] },
  { id: 'AGPL-3.0', required: [/GNU AFFERO GENERAL PUBLIC LICENSE/, /Version 3/] },
  { id: 'MPL-2.0', required: [/Mozilla Public License/i, /Version 2\.0/i] },
];

const PROPRIETARY = [/All rights reserved(?!.*(?:Apache|MIT|BSD))/i, /Proprietary/i, /Confidential/i, /Trade secret/i, /Not for distribution/i, /Internal use only/i, /Do not copy/i, /Commercial license required/i, /Licensed for evaluation only/i];

const norm = (s: string) => s.trim().replace(/^["']|["']$/g, '').toLowerCase();
const isIn = (list: string[], id: string) => list.some((l) => norm(l) === norm(id));

export function detectLicense(text: string): string | null {
  for (const p of PATTERNS) {
    if (p.required.every((r) => r.test(text)) && !(p.exclude ?? []).some((r) => r.test(text))) return p.id;
  }
  return null;
}

export function validateLicense(pkg: SkillPackage, c: Collector): void {
  const C = 'LICENSE';
  const manifest = findManifest(pkg);
  const fm = manifest?.text ? parseManifest(manifest.text) : null;
  const declared = fm?.data ? str(fm.data['license']).trim() : '';
  const licFile = pkg.files.find((f) => /^(license|licence|copying|notice)(\.(txt|md|rst))?$/i.test(basename(f.path)) && !f.path.includes('/'));
  const fileText = licFile?.text ?? '';
  const detected = fileText ? detectLicense(fileText) : null;

  // SPDX identifiers in source headers (first 50 lines)
  const spdx = new Map<string, string>();
  for (const f of pkg.files) {
    if (f.text === null || isExcludedPath(f.path) || !['.py', '.sh', '.js', '.ts', '.yaml', '.yml', '.md', '.txt', '.json', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h'].includes(ext(f.path))) continue;
    const head = f.text.split('\n').slice(0, 50).join('\n');
    const m = /SPDX-License-Identifier:\s*([^\n*]+)/.exec(head);
    if (m) spdx.set(f.path, m[1].trim());
  }
  const spdxIds = [...new Set(spdx.values())];

  const ids = [declared, detected ?? '', ...spdxIds].filter(Boolean);
  if (!ids.length && !licFile) {
    c.add(C, 'license_missing', 'low', 'No license declared (no `license:` in frontmatter and no LICENSE file)', {
      filePath: manifest?.path, suggestion: 'Add `license: Apache-2.0` (or MIT, etc.) to the frontmatter and include a LICENSE file so others know they may use the skill.',
    });
    return;
  }

  let problems = 0;
  for (const id of new Set(ids)) {
    for (const part of id.split(/\s+(?:OR|AND|WITH)\s+|[()]/i).map((s) => s.trim()).filter(Boolean)) {
      if (isIn(BLOCKED, part)) {
        problems++;
        c.add(C, 'license_blocked', 'high', `License '${part}' is restrictive (copyleft, non-commercial, or proprietary)`, {
          filePath: licFile?.path ?? manifest?.path, suggestion: 'Skills are usually shared under permissive licenses such as Apache-2.0, MIT, or BSD.',
        });
      } else if (!isIn(ALLOWED, part)) {
        problems++;
        c.add(C, 'license_unrecognized', 'low', `License '${part}' isn't a recognized permissive SPDX identifier`, {
          filePath: licFile?.path ?? manifest?.path, suggestion: 'Use an SPDX identifier like Apache-2.0 or MIT.',
        });
      }
    }
  }
  if (fileText && PROPRIETARY.some((r) => r.test(fileText)) && !detected) {
    problems++;
    c.add(C, 'license_proprietary', 'high', 'LICENSE contains proprietary or restrictive wording', { filePath: licFile!.path, suggestion: 'Replace it with a standard open-source license text if you intend to share this skill.' });
  }
  if (declared && detected && norm(declared) !== norm(detected) && !isIn([detected], declared)) {
    problems++;
    c.add(C, 'license_mismatch', 'medium', `Frontmatter says '${declared}' but the LICENSE file looks like '${detected}'`, {
      filePath: manifest?.path, suggestion: 'Make them agree.',
    });
  }
  if (spdxIds.length > 1) {
    problems++;
    c.add(C, 'license_inconsistent_spdx', 'low', `Source files use different SPDX identifiers: ${spdxIds.join(', ')}`, { suggestion: 'Use one license identifier across the skill.' });
  }
  if (!declared && licFile) {
    c.add(C, 'license_not_in_frontmatter', 'info', 'LICENSE file present but no `license:` field in frontmatter', {
      filePath: manifest?.path, suggestion: `Add license: ${detected ?? 'Apache-2.0'} to the frontmatter.`,
    });
  }
  if (!problems) c.pass(C, 'license', `License OK: ${[...new Set(ids)].join(', ')}`);
}
