import { parseManifest } from '../frontmatter';
import {
  EXECUTABLE_SKILL_DIRS, QUALITY_EXCLUDED_DIRS, QUALITY_RESOURCE_DIRS, QUALITY_WEIGHTS, RECOMMENDED_MAX_TOKENS, RESERVED_NAMES,
} from '../limits';
import type { DimensionName, QualityDimension, QualityIssue, QualityScore, SkillFile, SkillPackage, SkillType } from '../types';
import { scoreToGrade } from '../types';
import { XML_TAG_RE, basename, containsAny, ext, findManifest, markdownLinks, resolveLocalLink } from '../util';
import type { Collector } from './ctx';

function newDim(name: DimensionName): QualityDimension {
  return { name, score: 100, weight: QUALITY_WEIGHTS[name], issues: [] };
}

function deduct(d: QualityDimension, amount: number, severity: QualityIssue['severity'], message: string, suggestion?: string): void {
  d.issues.push({ severity, dimension: d.name, message, suggestion, deduction: amount });
  d.score = Math.max(0, d.score - amount);
}

const ERROR_HANDLING_RE = /\b(?:errors?|exceptions?|invalid|fail(?:s|ed|ure|ures|ing)?|validat(?:e|es|ed|ing|ion|ions))\b/i;

const topDirs = (pkg: SkillPackage): Set<string> => new Set(pkg.files.filter((f) => f.path.includes('/')).map((f) => f.path.split('/')[0]));
const directChildren = (pkg: SkillPackage, dir: string): SkillFile[] => pkg.files.filter((f) => f.path.startsWith(dir + '/') && !f.path.slice(dir.length + 1).includes('/'));

export function executableFiles(pkg: SkillPackage, exts = ['.py', '.sh']): SkillFile[] {
  return EXECUTABLE_SKILL_DIRS.flatMap((d) => directChildren(pkg, d)).filter((f) => exts.includes(ext(f.path)));
}

function findLibModule(pkg: SkillPackage): string | null {
  for (const d of topDirs(pkg)) {
    if (QUALITY_EXCLUDED_DIRS.has(d) || d.startsWith('.')) continue;
    if (pkg.files.some((f) => f.path === `${d}/__init__.py`)) return d;
  }
  return null;
}

export function detectSkillType(pkg: SkillPackage): SkillType {
  const hasScripts = executableFiles(pkg).length > 0;
  const hasLib = findLibModule(pkg) !== null;
  const tops = topDirs(pkg);
  const hasResources = QUALITY_RESOURCE_DIRS.some((d) => tops.has(d));
  if (hasScripts && (hasLib || hasResources)) return 'hybrid';
  if (hasScripts) return 'script-based';
  if (hasLib) return 'lib-based';
  if (hasResources) return 'resource-based';
  return 'guide-only';
}

const hasApiDocs = (content: string) =>
  [/\bimport\s+[A-Za-z_][A-Za-z0-9_.]*/i, /\bfrom\s+[A-Za-z_][A-Za-z0-9_.]*\s+import\b/i, /\bapi\b/i, /\bmodules?\b/i, /\blibrar(?:y|ies)\b/i, /\bpackages?\b/i, /\bclasses?\b/i, /\bfunctions?\b/i].some((r) => r.test(content));

function nestedMdReference(content: string): boolean {
  for (const { href } of markdownLinks(content)) {
    const t = resolveLocalLink('references/x.md', href);
    if (!t || !t.toLowerCase().endsWith('.md')) continue;
    if (t.toLowerCase() === 'skill.md') continue;
    return true;
  }
  return false;
}

/** 4-dimension quality score (port of NVIDIA's QualityScoreValidator). */
export function scoreQuality(pkg: SkillPackage, c: Collector): QualityScore | null {
  const manifest = findManifest(pkg);
  if (!manifest || manifest.text === null) {
    c.add('QUALITY', 'skill_manifest', 'high', 'SKILL.md not found — cannot score quality');
    return null;
  }
  const content = manifest.text.replace(/^﻿/, '');
  const lines = content.split('\n');
  const fmParsed = parseManifest(content);
  const fm = fmParsed.data;

  const correctness = newDim('correctness');
  const discoverability = newDim('discoverability');
  const reliability = newDim('reliability');
  const efficiency = newDim('efficiency');
  const skillType = detectSkillType(pkg);
  const skillName = pkg.dirName;

  // ---------------- Correctness ----------------
  if (fm) {
    for (const [key, val] of Object.entries(fm)) {
      if (key === 'name' || key === 'description') continue;
      if (XML_TAG_RE.test(String(val))) {
        deduct(correctness, 15, 'error', `XML tags in frontmatter field '${key}' (potential prompt injection)`, 'Remove XML angle brackets from all frontmatter fields');
        break;
      }
    }
    const name = String(fm['name'] ?? '').trim();
    if (name) {
      if (!/^[a-z0-9-]+$/.test(name)) deduct(correctness, 15, 'error', `Invalid name format: '${name}' (lowercase/numbers/hyphens only)`, 'Use only lowercase letters, numbers, and hyphens');
      if (containsAny(name, RESERVED_NAMES)) deduct(correctness, 15, 'error', 'Name contains reserved word (anthropic, claude)', 'Remove reserved words from skill name');
      if (XML_TAG_RE.test(name)) deduct(correctness, 15, 'error', 'Name contains XML tags', 'Remove XML tags from skill name');
    }
    const desc = String(fm['description'] ?? '').trim();
    if (desc && XML_TAG_RE.test(desc)) deduct(correctness, 15, 'error', 'Description contains XML tags', 'Remove XML tags from description');
  }

  const resKw = ['template', 'asset', 'design', 'style', 'css', 'html', 'resource'];
  if (skillType === 'script-based' || skillType === 'hybrid') {
    const scripts = executableFiles(pkg);
    const hasDir = EXECUTABLE_SKILL_DIRS.some((d) => pkg.files.some((f) => f.path.startsWith(d + '/')));
    if (hasDir) {
      if (scripts.length === 0) deduct(correctness, 10, 'warning', 'scripts/ or tools/ exists but contains no .py or .sh files');
    } else deduct(correctness, 25, 'error', 'No scripts/ or tools/ directory found (detected as script-based skill)', 'Create scripts/ or tools/ with at least one executable script');
    if (!content.includes('## Available Scripts') && !content.includes('| Script |')) {
      deduct(correctness, 10, 'warning', 'No documented scripts in table format', "Add '## Available Scripts' with table: | Script | Purpose | Arguments |");
    }
  } else if (skillType === 'lib-based') {
    const lib = findLibModule(pkg);
    if (lib) {
      if (!pkg.files.some((f) => f.path === 'pyproject.toml')) deduct(correctness, 10, 'warning', 'Lib-based skill missing pyproject.toml', 'Add pyproject.toml with package metadata and dependencies');
      if (!hasApiDocs(content)) deduct(correctness, 10, 'warning', 'Lib-based skill lacks API/import documentation', 'Document how to import and use the library');
    } else deduct(correctness, 15, 'warning', 'Detected as lib-based but no Python module found', 'Ensure module directory has __init__.py');
  } else if (skillType === 'resource-based') {
    if (!containsAny(content, resKw)) deduct(correctness, 10, 'warning', 'Resource-based skill lacks documentation of available resources', 'Document available templates, assets, and design resources in SKILL.md');
  } else {
    const bodyLines = lines.filter((l) => l.trim()).length;
    if (bodyLines < 20) deduct(correctness, 15, 'warning', `Guide-only skill has very little content (${bodyLines} lines)`, 'Guide skills should have detailed instructions since they have no code');
  }

  if (!(content.includes('```') || content.includes('Example:') || content.includes('**Example:**')) && !content.includes('## Examples')) {
    deduct(correctness, 5, 'info', 'No examples provided', 'Add example usage with code blocks');
  }
  if (/(?:scripts|references|assets)\\[\w\\]+/.test(content)) deduct(correctness, 10, 'warning', 'Windows-style paths detected', 'Use forward slashes for cross-platform compatibility');
  if (pkg.files.some((f) => f.path === 'README.md')) {
    const refsReadme = markdownLinks(content).some(({ href }) => resolveLocalLink('SKILL.md', href)?.toLowerCase() === 'readme.md');
    if (refsReadme) deduct(correctness, 5, 'warning', 'SKILL.md references README.md (pulls human-facing docs into agent context)', 'Keep README.md human-facing and unreferenced; move agent-facing content into SKILL.md or a references/ file');
  }

  // spec fields (recommended)
  if (fm) {
    const meta = fm['metadata'] && typeof fm['metadata'] === 'object' ? (fm['metadata'] as Record<string, unknown>) : {};
    const hasVersion = (fm['version'] ?? meta['version']) != null;
    if (!hasVersion) deduct(correctness, 5, 'warning', "Recommended field missing: 'version'", 'Add version: "1.0.0" (top level or under metadata:) so changes can be tracked');
    if (meta['author'] == null) deduct(correctness, 5, 'warning', "Recommended field missing: 'metadata.author'", "Add 'author' under metadata: — author name or team");
    if (meta['tags'] == null) deduct(correctness, 5, 'warning', "Recommended field missing: 'metadata.tags'", "Add 'tags' under metadata: — a list of 1-5 categorization tags");
  }

  // ---------------- Discoverability ----------------
  const desc = fm ? String(fm['description'] ?? '').trim() : '';
  if (desc) {
    if (desc.length < 20) deduct(discoverability, 20, 'warning', `Description too short (${desc.length} chars, recommend 50-150)`, 'Add more context: what tasks does this skill handle?');
    else if (desc.length > 200) deduct(discoverability, 5, 'info', `Description very long (${desc.length} chars, recommend 50-150)`, 'Keep descriptions concise for progressive disclosure');
    if (!containsAny(desc, ['use', 'when', 'for', 'helps', 'allows'])) deduct(discoverability, 10, 'info', "Description doesn't mention WHEN to use this skill", "Add trigger context: 'Use for...', 'When you need to...'");
    if (containsAny(desc, ['something', 'things', 'stuff', 'various', 'general'])) deduct(discoverability, 15, 'warning', 'Description contains vague words', 'Be specific about what this skill does');
    if (containsAny(desc, ['i can', 'i will', 'you can', 'you should', 'your', 'my', 'we can'])) deduct(discoverability, 15, 'warning', 'Description uses first/second person', "Use third person: 'Processes files' not 'I can process'");
    if (desc.length > 100 && containsAny(desc, ['data', 'files', 'documents', 'project', 'manage', 'handle', 'process']) && !containsAny(desc, ['not for', 'do not use', 'instead use', 'except when', 'not when'])) {
      deduct(discoverability, 5, 'info', 'Broad description without negative triggers may cause over-triggering', "Add boundary phrases like 'Do NOT use for...'");
    }
  }
  if (!content.includes('## Purpose')) deduct(discoverability, 5, 'info', "No '## Purpose' section", 'Add purpose section to clarify use cases');
  if (skillName.length < 5) deduct(discoverability, 10, 'warning', `Skill name very short: '${skillName}'`, "Use descriptive names like 'crypto-utils' not 'crypto'");
  if (!/^[a-z][a-z0-9_-]*$/.test(skillName)) deduct(discoverability, 10, 'warning', `Skill name not following convention: '${skillName}'`, 'Use lowercase with hyphens: my-skill-name');

  // ---------------- Reliability ----------------
  if (!ERROR_HANDLING_RE.test(content)) deduct(reliability, 10, 'info', 'No mention of error handling or validation', 'Document expected errors and how to handle them');
  if (skillType === 'script-based' || skillType === 'hybrid') {
    const bad = executableFiles(pkg, ['.py']).filter((f) => {
      const sc = f.text ?? '';
      const hasTry = sc.includes('try:') && sc.includes('except');
      const hasErr = ['if not ', 'if error', 'raise', 'assert', 'ValueError', 'FileNotFoundError'].some((p) => sc.includes(p));
      return f.text !== null && !(hasTry || hasErr);
    });
    if (bad.length) deduct(reliability, 5, 'info', `Scripts may lack error handling: ${bad.slice(0, 3).map((f) => basename(f.path)).join(', ')}`, 'Scripts should handle errors explicitly');
  } else if (skillType === 'lib-based') {
    const lib = findLibModule(pkg);
    if (lib) {
      const bad = pkg.files.filter((f) => f.path.startsWith(lib + '/') && ext(f.path) === '.py' && basename(f.path) !== '__init__.py' && f.text !== null).filter((f) => {
        const pc = f.text!;
        return !((pc.includes('try:') && pc.includes('except')) || ['raise', 'assert', 'ValueError', 'TypeError', 'RuntimeError'].some((p) => pc.includes(p)));
      });
      if (bad.length) deduct(reliability, 5, 'info', `Lib modules may lack error handling: ${bad.slice(0, 3).map((f) => basename(f.path)).join(', ')}`, 'Library code should handle errors explicitly with try/except or raise');
    }
  }
  if (!content.includes('## Prerequisites') && !content.includes('## Requirements')) deduct(reliability, 5, 'info', 'No prerequisites/requirements documented', 'Document dependencies, API keys, or setup needed');
  if (!content.includes('## Limitations')) deduct(reliability, 5, 'info', 'No limitations documented', "Add '## Limitations' section with known issues/constraints");
  if (!['## Troubleshooting', '## Common Issues', '## FAQ'].some((s) => content.includes(s))) deduct(reliability, 5, 'info', 'No troubleshooting section documented', "Add '## Troubleshooting' with Error/Cause/Solution patterns");

  // ---------------- Efficiency ----------------
  const totalTokens = Math.floor(content.length / 4);
  const frontmatterTokens = Math.floor(fmParsed.raw.length / 4);
  if (totalTokens > RECOMMENDED_MAX_TOKENS) {
    deduct(efficiency, 15, 'error', `Large skill (${totalTokens} tokens, recommended max <${RECOMMENDED_MAX_TOKENS}). SKILL.md should be concise (~500 lines) — large bodies increase token cost after invocation`,
      'Keep required sections concise; move detailed examples and reference material to the references/ directory');
  }
  const nonEmpty = lines.filter((l) => l.trim());
  const unique = new Set(nonEmpty.map((l) => l.trim()));
  if (unique.size && unique.size < nonEmpty.length * 0.7) deduct(efficiency, 10, 'info', 'High line repetition detected', 'Remove duplicate instructions or use references');

  let section = '';
  for (const heading of ['## Instructions', '## Usage']) {
    if (!content.includes(heading)) continue;
    const parts = content.split(`\n${heading}\n`);
    section = parts.length > 1 ? parts[1].split('\n## ')[0] : '';
    break;
  }
  if (section) {
    if (!containsAny(section, ['use', 'call', 'run', 'execute', 'pass', 'set', 'add', 'mark', 'update', 'keep'])) deduct(efficiency, 15, 'warning', 'Instructions lack clear action verbs', "Use imperative: 'Run scripts/x.py with...', 'Call ...'");
    if (!(section.includes('- ') || section.includes('1.') || section.includes('* '))) deduct(efficiency, 5, 'info', 'Instructions not in list format', 'Use bullet points or numbered steps for clarity');
  }
  if (containsAny(content, ['utilize', 'facilitate', 'leverage', 'paradigm', 'synergy'])) deduct(efficiency, 5, 'info', 'Uses complex/corporate language', "Use simple, direct language: 'use' not 'utilize'");

  const refs = directChildren(pkg, 'references');
  if (refs.length) {
    const vague = ['doc', 'file', 'data', 'info', 'misc', 'temp'];
    const refMd = refs.filter((r) => ext(r.path) === '.md');
    const badName = refMd.find((r) => {
      const stem = basename(r.path).replace(/\.md$/i, '').toLowerCase();
      return /^\d+$/.test(stem) || vague.includes(stem) || stem.length < 4;
    });
    if (badName) deduct(efficiency, 5, 'info', `Non-descriptive filename: ${basename(badName.path)}`, "Use descriptive names: 'form_validation_rules.md' not 'doc2.md'");
    const nested = refMd.find((r) => r.text !== null && nestedMdReference(r.text));
    if (nested) deduct(efficiency, 10, 'warning', `Deeply nested references in ${basename(nested.path)}`, 'Keep references one level deep from SKILL.md');
    const nonDoc = refs.find((r) => ['.py', '.sh', '.json', '.csv', '.yaml', '.yml', '.toml'].includes(ext(r.path)));
    if (nonDoc) deduct(efficiency, 5, 'info', `Non-doc file in references/: ${basename(nonDoc.path)}`, 'Code belongs in scripts/, data in assets/. references/ is for .md docs.');
  }

  const dims = { correctness, discoverability, reliability, efficiency };
  const overall = correctness.score * correctness.weight + discoverability.score * discoverability.weight + reliability.score * reliability.weight + efficiency.score * efficiency.weight;
  const result: QualityScore = { overall, grade: scoreToGrade(overall), skillType, dimensions: dims, totalTokens, frontmatterTokens };

  const sev = { error: 'high', warning: 'medium', info: 'low' } as const;
  for (const d of Object.values(dims)) {
    for (const i of d.issues) {
      c.add('QUALITY', `quality_${d.name}`, sev[i.severity], i.message, { filePath: manifest.path, suggestion: i.suggestion, data: { dimension: d.name, deduction: i.deduction } });
    }
  }
  c.pass('QUALITY', 'quality_score', `Score ${overall.toFixed(1)}/100 (Grade ${result.grade}, ${skillType})`);
  return result;
}

