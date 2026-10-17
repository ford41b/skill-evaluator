import { parseManifest, str } from '../frontmatter';
import {
  ALLOWED_SKILL_DIRS, COMPATIBILITY_MAX, DESCRIPTION_MAX, FORBIDDEN_FIELDS, KEBAB_RE, MAX_SKILL_MD_LINES, NAME_MAX, RESERVED_NAMES,
} from '../limits';
import type { SkillPackage } from '../types';
import { XML_TAG_RE, basename, findManifest, lineText } from '../util';
import type { Collector } from './ctx';

const AUTHOR_RE = /^\S[^<>\n]* <[^<>@\s]+@[^<>\s]+>$/;
const SEMVER_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const ROOT_FILES_OK = /^(skill\.md|readme\.md|license(\.\w+)?|licence(\.\w+)?|copying(\.txt)?|notice(\.txt)?|changelog\.md|pyproject\.toml|requirements\.txt|\.gitignore)$/i;

export interface SchemaOutput {
  name: string;
  description: string;
}

/** Frontmatter schema, naming, and structure checks (port of NVIDIA SchemaValidator). */
export function validateSchema(pkg: SkillPackage, c: Collector): SchemaOutput {
  const C = 'SCHEMA';
  const manifest = findManifest(pkg);
  const out: SchemaOutput = { name: '', description: '' };

  if (!manifest) {
    c.add(C, 'manifest_exists', 'critical', 'SKILL.md not found in skill directory', { suggestion: 'Add a SKILL.md with YAML frontmatter.' });
    return out;
  }
  c.pass(C, 'manifest_exists', `Found skill manifest: ${manifest.path}`);

  if (basename(manifest.path) !== 'SKILL.md') {
    c.add(C, 'manifest_naming', 'medium', `Manifest is named '${basename(manifest.path)}' — it must be exactly 'SKILL.md'`, {
      filePath: manifest.path, suggestion: 'Rename the file to SKILL.md (uppercase) so every platform finds it.',
    });
  }

  const text = manifest.text;
  if (text === null) {
    c.add(C, 'file_readable', 'high', 'SKILL.md could not be read as text (binary or larger than 1 MB)', { filePath: manifest.path });
    return out;
  }

  const fm = parseManifest(text);
  if (!fm.hasFrontmatter) {
    c.add(C, 'frontmatter_format', 'critical', 'SKILL.md must start with YAML frontmatter between --- markers', {
      filePath: manifest.path, line: 1, snippet: lineText(text, 1),
      suggestion: 'Start the file with:\n---\nname: my-skill\ndescription: What it does and when to use it.\n---',
    });
    return out;
  }
  if (fm.yamlError) {
    c.add(C, 'yaml_syntax', 'high', `Invalid YAML in frontmatter: ${fm.yamlError.message}`, {
      filePath: manifest.path, line: fm.yamlError.line, snippet: fm.yamlError.line ? lineText(text, fm.yamlError.line) : undefined,
      suggestion: 'Quote values containing colons (e.g. description: "Use for: parsing") and check indentation.',
    });
    return out;
  }
  if (!fm.data || Object.keys(fm.data).length === 0) {
    c.add(C, 'frontmatter_content', 'high', 'Frontmatter must be a non-empty YAML mapping', { filePath: manifest.path, line: 2 });
    return out;
  }
  const d = fm.data;
  const keyLine = (k: string) => fm.keyLines[k] ?? 2;
  const at = (k: string) => ({ filePath: manifest.path, line: keyLine(k), snippet: lineText(text, keyLine(k)) });

  // --- name -----------------------------------------------------------
  const nameRaw = d['name'];
  const name = str(nameRaw).trim();
  out.name = name;
  let fieldProblems = 0;
  if (nameRaw === undefined || name === '') {
    fieldProblems++;
    c.add(C, 'frontmatter_field', 'high', "Field 'name': required", { ...at('name'), suggestion: 'Add name: my-skill-name (lowercase letters, numbers, hyphens).' });
  } else {
    const nameErrors: string[] = [];
    if (name.length > NAME_MAX) nameErrors.push(`exceeds ${NAME_MAX} characters (${name.length})`);
    if (!KEBAB_RE.test(name)) nameErrors.push('must be kebab-case: lowercase letters, numbers and hyphens, starting with a letter');
    if (name.includes('--')) nameErrors.push('cannot contain consecutive hyphens');
    if (name.endsWith('-')) nameErrors.push('cannot end with a hyphen');
    if (name.toLowerCase().split(/[^a-z0-9]+/).some((s) => RESERVED_NAMES.includes(s))) nameErrors.push(`must not contain reserved words (${RESERVED_NAMES.join(', ')})`);
    if (XML_TAG_RE.test(name)) nameErrors.push('must not contain XML tags');
    for (const e of nameErrors) {
      fieldProblems++;
      c.add(C, 'frontmatter_field', 'high', `Field 'name' ('${name}'): ${e}`, { ...at('name'), suggestion: 'Example: pdf-extractor' });
    }
  }

  // --- description ----------------------------------------------------
  const descRaw = d['description'];
  const desc = str(descRaw).trim();
  out.description = desc;
  if (descRaw === undefined || desc === '') {
    fieldProblems++;
    c.add(C, 'frontmatter_field', 'high', "Field 'description': required", { ...at('description'), suggestion: 'Say what the skill does AND when an agent should use it.' });
  } else {
    if (desc.length > DESCRIPTION_MAX) {
      fieldProblems++;
      c.add(C, 'frontmatter_field', 'high', `Field 'description': exceeds ${DESCRIPTION_MAX} characters (${desc.length})`, { ...at('description'), suggestion: 'Shorten it; move detail into the SKILL.md body.' });
    }
    if (XML_TAG_RE.test(desc)) {
      fieldProblems++;
      c.add(C, 'frontmatter_field', 'high', "Field 'description': must not contain XML tags", { ...at('description'), suggestion: 'Remove angle-bracket tags from the description.' });
    }
  }

  // --- optional fields ------------------------------------------------
  if (d['compatibility'] !== undefined && str(d['compatibility']).length > COMPATIBILITY_MAX) {
    fieldProblems++;
    c.add(C, 'frontmatter_field', 'high', `Field 'compatibility': exceeds ${COMPATIBILITY_MAX} characters`, at('compatibility'));
  }
  const forbidden = FORBIDDEN_FIELDS.filter((f) => f in d);
  if (forbidden.length) {
    fieldProblems++;
    c.add(C, 'frontmatter_field', 'high', `Forbidden fields: ${forbidden.join(', ')}. Skills must not use 'alwaysApply' or 'globs'.`, {
      ...at(forbidden[0]), suggestion: 'Remove them — those belong to rules, not skills.',
    });
  }
  const meta = d['metadata'];
  const metaObj = meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null;
  if (meta !== undefined && meta !== null && !metaObj) {
    fieldProblems++;
    c.add(C, 'frontmatter_field', 'high', "Field 'metadata': must be a mapping (author, tags, …)", at('metadata'));
  }
  const version = str(metaObj?.['version'] ?? d['version']);
  if (version && !SEMVER_RE.test(version)) {
    c.add(C, 'frontmatter_field', 'medium', `Version '${version}' is not a semantic version (MAJOR.MINOR.PATCH)`, { ...at(metaObj?.['version'] !== undefined ? 'metadata' : 'version'), suggestion: 'Use something like 1.0.0.' });
  }
  if (fieldProblems === 0) c.pass(C, 'frontmatter_valid', `Valid frontmatter for skill '${name}'`);

  // --- folder / directory name ----------------------------------------
  const dir = pkg.dirName;
  const dirProblems: string[] = [];
  if (!KEBAB_RE.test(dir)) dirProblems.push(`Folder '${dir}' must be kebab-case (lowercase, numbers, hyphens)`);
  if (dir.includes('--')) dirProblems.push(`Folder '${dir}' cannot contain consecutive hyphens`);
  if (dir.length > NAME_MAX) dirProblems.push(`Folder '${dir}' exceeds ${NAME_MAX} chars`);
  if (dirProblems.length) for (const p of dirProblems) c.add(C, 'naming_convention', 'medium', p, { suggestion: 'Rename the folder to match the skill name.' });
  else c.pass(C, 'naming_convention', `Folder name '${dir}' follows kebab-case convention`);

  if (name) {
    if (name !== dir) {
      c.add(C, 'name_consistency', 'high', `Folder name '${dir}' doesn't match frontmatter name '${name}'`, {
        ...at('name'), suggestion: `Rename the folder to '${name}' or change name: to '${dir}'.`,
      });
    } else c.pass(C, 'name_consistency', `Folder name matches frontmatter: '${name}'`);
  }

  // --- size / body ----------------------------------------------------
  const lineCount = text.split('\n').length;
  if (lineCount > MAX_SKILL_MD_LINES) {
    c.add(C, 'line_count', 'medium', `SKILL.md has ${lineCount} lines (limit: ${MAX_SKILL_MD_LINES})`, {
      filePath: manifest.path, suggestion: 'Move detailed reference material into references/*.md and link to it (progressive disclosure).',
    });
  } else c.pass(C, 'line_count', `SKILL.md within line limit (${lineCount}/${MAX_SKILL_MD_LINES})`);

  const body = fm.body;
  if (!/^#\s+\S/m.test(body.replace(/```[\s\S]*?```/g, ''))) {
    c.add(C, 'body_heading', 'medium', 'Missing top-level heading (# Title) in SKILL.md body', {
      filePath: manifest.path, line: fm.bodyStartLine, suggestion: 'Start the body with "# Skill Title".',
    });
  } else c.pass(C, 'body_heading', 'Body contains a top-level heading');

  const hasInstr = /^##\s+(Instructions|Usage)\b/im.test(body);
  if (hasInstr) c.pass(C, 'body_recommended_section', "Found recommended section: '## Instructions' (or '## Usage')");
  else c.add(C, 'body_recommended_section', 'medium', "Missing recommended section: '## Instructions' (or '## Usage')", {
    filePath: manifest.path, suggestion: 'Add numbered steps telling the agent exactly what to do.',
  });
  if (/^##\s+Examples?\b/im.test(body)) c.pass(C, 'body_recommended_section', "Found recommended section: '## Examples'");
  else c.add(C, 'body_recommended_section', 'medium', "Missing recommended section: '## Examples'", {
    filePath: manifest.path, suggestion: "Add '## Examples'. If examples are already inline under instructions, this can be skipped.",
  });

  // --- author ---------------------------------------------------------
  const author = str(metaObj?.['author']).trim();
  if (author) {
    if (AUTHOR_RE.test(author)) c.pass(C, 'author_format', `Valid author format: ${author}`);
    else c.add(C, 'author_format', 'medium', "Author must be of the form 'Name <email@host>'", {
      ...at('metadata'), snippet: `author: ${author}`, suggestion: "Use: 'Full Name <email@example.com>'",
    });
  } else {
    c.add(C, 'author_missing', 'low', 'Author not specified in metadata', {
      filePath: manifest.path, suggestion: "Add under metadata: author: 'Full Name <email@example.com>'",
    });
  }

  // --- folder structure -----------------------------------------------
  const unexpected = new Set<string>();
  for (const f of pkg.files) {
    const i = f.path.indexOf('/');
    if (i < 0) {
      if (!ROOT_FILES_OK.test(f.path)) unexpected.add(f.path);
    } else {
      const top = f.path.slice(0, i);
      if (!ALLOWED_SKILL_DIRS.has(top) && !top.startsWith('.') && top !== 'examples' && top !== 'docs') unexpected.add(top + '/');
    }
  }
  if (unexpected.size) {
    for (const u of [...unexpected].slice(0, 10)) {
      c.add(C, 'folder_structure', 'low', `Unexpected item in skill root: ${u}`, {
        filePath: u.endsWith('/') ? undefined : u,
        suggestion: 'Standard layout: SKILL.md plus scripts/, references/, assets/, evals/. Move this or reference it from SKILL.md.',
      });
    }
  } else c.pass(C, 'folder_structure', 'Folder structure follows the standard skill layout');

  return out;
}
