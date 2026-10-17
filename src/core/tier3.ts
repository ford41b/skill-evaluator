import { parse as parseYaml } from 'yaml';
import { skillDoc } from './tier2';
import type { SkillDoc } from './tier2';
import { termsMatch, tokenize } from './text';
import type {
  EvalCase, EvalDataset, Finding, ReadinessBreakdown, SkillPackage, Tier3Result, TierStatus, TriggerResult, TriggerVerdict,
} from './types';
import { scoreToGrade } from './types';
import { basename, clip, ext, findManifest } from './util';
import { Collector } from './validators/ctx';

// ---------------------------------------------------------------------------
// Trigger simulation (offline stand-in for "would an agent pick this skill?")
// ---------------------------------------------------------------------------

export interface TriggerIndexEntry {
  name: string;
  /** stem -> weight */
  terms: Map<string, number>;
}

export function buildTriggerIndex(docs: Pick<SkillDoc, 'name' | 'desc' | 'body'>[]): TriggerIndexEntry[] {
  return docs.map((d) => {
    const terms = new Map<string, number>();
    const put = (stems: string[], w: number) => {
      for (const s of stems) terms.set(s, Math.max(terms.get(s) ?? 0, w));
    };
    put(tokenize(d.body.split('\n').filter((l) => /^#{1,3}\s/.test(l)).join(' ')), 0.4);
    put(tokenize(d.body.split('\n').slice(0, 40).join(' ')), 0.3);
    put(tokenize(d.desc), 1);
    put(tokenize(d.name.replace(/-/g, ' ')), 1.5);
    return { name: d.name, terms };
  });
}

function weightFor(entry: TriggerIndexEntry, stem: string): number {
  const direct = entry.terms.get(stem);
  if (direct !== undefined) return direct;
  let best = 0;
  for (const [t, w] of entry.terms) if (w > best && termsMatch(t, stem)) best = w;
  return best;
}

function scorePrompt(entry: TriggerIndexEntry, stems: string[]): { total: number; matched: string[] } {
  let total = 0;
  const matched: string[] = [];
  for (const s of stems) {
    const w = weightFor(entry, s);
    if (w > 0) {
      total += w;
      matched.push(s);
    }
  }
  return { total, matched };
}

export function simulateTrigger(prompt: string, index: TriggerIndexEntry[], selfIdx: number): TriggerResult {
  const stems = [...new Set(tokenize(prompt))];
  const me = scorePrompt(index[selfIdx], stems);
  let competitor: TriggerResult['competitor'];
  for (let i = 0; i < index.length; i++) {
    if (i === selfIdx) continue;
    const o = scorePrompt(index[i], stems);
    if (o.total > 0 && (!competitor || o.total > competitor.score)) competitor = { name: index[i].name, score: o.total };
  }
  let verdict: TriggerVerdict = me.total >= 1.5 ? 'likely' : me.total >= 0.8 ? 'maybe' : 'unlikely';
  if (competitor && competitor.score > me.total * 1.05 && verdict !== 'unlikely') verdict = verdict === 'likely' ? 'maybe' : 'unlikely';
  if (competitor && competitor.score > me.total * 1.05 && me.total >= 1.5) verdict = 'maybe';
  return {
    prompt,
    score: Math.min(1, me.total / 2.5),
    verdict,
    matchedTerms: me.matched,
    competitor: competitor && competitor.score >= me.total * 0.75 ? { name: competitor.name, score: Math.min(1, competitor.score / 2.5) } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Eval dataset parsing + validation
// ---------------------------------------------------------------------------

const DATASET_PATHS = ['evals/evals.json', 'evals/evals.jsonl', 'evals/evals.yaml', 'evals/evals.yml'];

interface RawCase { [k: string]: unknown }

function parseDataset(path: string, text: string): unknown {
  if (path.endsWith('.json')) return JSON.parse(text);
  if (path.endsWith('.jsonl')) return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  return parseYaml(text);
}

const asStr = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(asStr).filter(Boolean) : typeof v === 'string' && v ? [v] : []);

export function generateStarterDataset(pkg: SkillPackage, name: string): EvalDataset {
  const manifest = findManifest(pkg);
  const text = manifest?.text ?? '';
  const cases: EvalCase[] = [];
  const id = () => `${name}-${String(cases.length + 1).padStart(3, '0')}`;

  // Commands shown in code examples become concrete, runnable test prompts.
  const cmdRe = /^\s*(?:\$\s*)?((?:python3?|bash|sh|node)\s+(?:\.\/)?((?:scripts|tools)\/[\w./-]+)[^\n]*)$/gm;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(text)) && cases.length < 4) {
    const cmd = m[1].trim();
    if (seen.has(cmd) || cmd.startsWith('#')) continue;
    seen.add(cmd);
    const script = basename(m[2]);
    const arg = /["']([^"']+)["']/.exec(cmd)?.[1];
    cases.push({
      id: id(),
      prompt: arg ? `Use the ${name} skill to handle this: ${arg}` : `Use the ${name} skill. Example from its docs: ${cmd}`,
      expected_output: `The agent runs ${m[2]}${arg ? ` with "${arg}"` : ''} and reports a correct result.`,
      assertions: [`Read ${name}/SKILL.md`, `Executed ${script}`, 'Reported a correct, complete answer'],
    });
  }
  if (!cases.length) {
    const manifestDesc = skillDoc(pkg).desc;
    const first = manifestDesc.split(/(?<=[.!?])\s/)[0] || `do what ${name} does`;
    cases.push({
      id: id(),
      prompt: `I need help with this: ${first.replace(/\.$/, '')}.`,
      expected_output: `The agent uses the ${name} skill and completes the task as described.`,
      assertions: [`Read ${name}/SKILL.md`, 'Followed the documented instructions', 'Produced a correct result'],
    });
  }
  cases.push({
    id: id(),
    prompt: `Use ${name} with deliberately invalid input and tell me what went wrong.`,
    expected_output: 'The agent surfaces a clear error and explains how to fix the input instead of failing silently.',
    assertions: ['Reported an error message', 'Suggested a fix'],
  });
  cases.push({
    id: id(),
    prompt: "What's a good recipe for banana bread?",
    expected_output: `The agent answers directly and does NOT use the ${name} skill.`,
    assertions: [`Did not read ${name}/SKILL.md`],
    should_trigger: false,
  });
  return { skill_name: name, evals: cases };
}

function allCaseText(cases: RawCase[]): string {
  return JSON.stringify(cases).toLowerCase();
}

export function evaluateTier3(pkg: SkillPackage, name: string, index: TriggerIndexEntry[], selfIdx: number): Tier3Result {
  const C = 'EVALS';
  const col = new Collector(3);
  const scripts = pkg.files.filter((f) => /^(scripts|tools)\//.test(f.path) && ['.py', '.sh', '.js', '.ts'].includes(ext(f.path)));
  const manifestPath = findManifest(pkg)?.path;

  const result: Tier3Result = {
    findings: [], passes: [], datasetPath: null, datasetFormat: null, caseCount: 0, triggers: [], generatedDataset: null,
    readiness: 0, grade: 'F', status: 'warn',
    breakdown: { dataset: 0, caseCount: 0, assertions: 0, scriptCoverage: 0, triggers: 0 },
  };
  const b: ReadinessBreakdown = result.breakdown;

  const dsFile = DATASET_PATHS.map((p) => pkg.files.find((f) => f.path === p)).find(Boolean);
  let cases: RawCase[] = [];
  let valid = false;

  if (!dsFile) {
    col.add(C, 'no_eval_dataset', 'medium', 'No eval dataset found — live agent evaluation has nothing to run', {
      filePath: 'evals/evals.json',
      suggestion: 'Add evals/evals.json with realistic prompts and expected outcomes. A starter file generated from your SKILL.md is available below.',
    });
    result.generatedDataset = generateStarterDataset(pkg, name);
  } else if (dsFile.text === null) {
    col.add(C, 'eval_dataset_unreadable', 'high', `${dsFile.path} could not be read as text`, { filePath: dsFile.path });
  } else {
    result.datasetPath = dsFile.path;
    let parsed: unknown;
    try {
      parsed = parseDataset(dsFile.path, dsFile.text);
    } catch (e) {
      col.add(C, 'eval_dataset_parse', 'high', `${dsFile.path} is not valid: ${(e as Error).message.split('\n')[0]}`, {
        filePath: dsFile.path, suggestion: 'Fix the syntax; validate it with a JSON/YAML linter.',
      });
    }
    if (parsed !== undefined) {
      let list: unknown;
      if (Array.isArray(parsed)) {
        result.datasetFormat = 'legacy';
        list = parsed;
        col.add(C, 'legacy_eval_format', 'low', 'Legacy flat-array eval format (id/question/ground_truth)', {
          filePath: dsFile.path, suggestion: 'Migrate to the agentskills.io format: {"skill_name": "...", "evals": [{"id","prompt","expected_output","assertions"}]}.',
        });
      } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as RawCase)['evals'])) {
        result.datasetFormat = 'agentskills';
        list = (parsed as RawCase)['evals'];
        const sn = asStr((parsed as RawCase)['skill_name']);
        if (!sn) col.add(C, 'eval_skill_name', 'low', "Dataset is missing 'skill_name'", { filePath: dsFile.path, suggestion: `Add "skill_name": "${name}".` });
        else if (sn !== name) col.add(C, 'eval_skill_name', 'medium', `Dataset skill_name '${sn}' doesn't match skill '${name}'`, { filePath: dsFile.path, suggestion: `Set "skill_name": "${name}".` });
      } else {
        col.add(C, 'eval_dataset_shape', 'high', 'Dataset must be a list of cases or an object with an "evals" array', {
          filePath: dsFile.path, suggestion: 'See the agentskills.io eval format: {"skill_name": "...", "evals": [...]}',
        });
      }
      if (Array.isArray(list)) {
        cases = list.filter((x): x is RawCase => !!x && typeof x === 'object');
        if (cases.length !== list.length) col.add(C, 'eval_case_shape', 'high', 'Some entries in the dataset are not objects', { filePath: dsFile.path });
        const legacy = result.datasetFormat === 'legacy';
        const ids = new Set<string>();
        const dupIds = new Set<string>();
        const bad: string[] = [];
        cases.forEach((cs, i) => {
          const cid = asStr(cs['id']);
          const prompt = asStr(legacy ? cs['question'] ?? cs['prompt'] : cs['prompt'] ?? cs['question']);
          const expected = asStr(cs['expected_output'] ?? cs['ground_truth']);
          const label = cid || `#${i + 1}`;
          if (!cid) bad.push(`${label}: missing id`);
          else if (ids.has(cid)) dupIds.add(cid);
          ids.add(cid);
          if (!prompt) bad.push(`${label}: missing ${legacy ? 'question' : 'prompt'}`);
          else if (prompt.trim().length < 15) col.add(C, 'eval_prompt_short', 'low', `Case ${label} has a very short prompt ("${clip(prompt, 40)}")`, { filePath: dsFile.path, suggestion: 'Realistic prompts read like what a user would actually type.' });
          if (!legacy && !expected) bad.push(`${label}: missing expected_output`);
          if (legacy) {
            const es = asStr(cs['expected_skill']);
            if (es && es !== name) col.add(C, 'eval_expected_skill', 'medium', `Case ${label} expects skill '${es}' but this skill is '${name}'`, { filePath: dsFile.path });
            const esc = asStr(cs['expected_script']);
            if (esc && !pkg.files.some((f) => basename(f.path) === esc)) col.add(C, 'eval_expected_script', 'medium', `Case ${label} expects script '${esc}' which isn't in this skill`, { filePath: dsFile.path });
          }
        });
        for (const e of bad.slice(0, 12)) col.add(C, 'eval_case_fields', 'high', `Eval case ${e}`, { filePath: dsFile.path });
        if (bad.length > 12) col.add(C, 'eval_case_fields', 'high', `…and ${bad.length - 12} more invalid cases`, { filePath: dsFile.path });
        for (const d of dupIds) col.add(C, 'eval_duplicate_id', 'high', `Duplicate eval case id '${d}'`, { filePath: dsFile.path, suggestion: 'Case ids must be unique.' });
        valid = bad.length === 0 && dupIds.size === 0 && cases.length > 0;
        result.caseCount = cases.length;

        if (cases.length === 0) col.add(C, 'eval_empty', 'high', 'Dataset contains no cases', { filePath: dsFile.path });
        else if (cases.length < 3) col.add(C, 'eval_few_cases', 'low', `Only ${cases.length} eval case${cases.length > 1 ? 's' : ''} — aim for 3-5+ covering different situations`, { filePath: dsFile.path, suggestion: 'Add an edge case, an error case, and a negative control.' });
        const noAssert = cases.filter((cs) => asList(cs['assertions']).length + asList(cs['expected_behavior']).length === 0);
        if (noAssert.length) col.add(C, 'eval_assertions', 'low', `${noAssert.length} of ${cases.length} cases have no assertions`, { filePath: dsFile.path, suggestion: 'Add checkable statements, e.g. "Executed calc.py" or "Reported 212°F".' });
        const hasNegative = cases.some((cs) => cs['should_trigger'] === false || /negative|control/i.test(asStr(cs['id']) + asStr(cs['type'])));
        if (!hasNegative && cases.length >= 2) col.add(C, 'eval_negative_control', 'info', 'No negative control (a prompt where the skill should NOT be used)', { filePath: dsFile.path, suggestion: 'Add a case with "should_trigger": false to catch over-triggering.' });

        b.assertions = cases.length ? 15 * (1 - noAssert.length / cases.length) : 0;
        b.caseCount = 20 * Math.min(cases.length, 5) / 5;
        b.dataset = valid ? 40 : cases.length ? 20 : 0;
        if (valid) col.pass(C, 'eval_dataset', `${cases.length} valid eval case(s) in ${dsFile.path}`);
      }
    }
    if (cases.length < 3) result.generatedDataset = generateStarterDataset(pkg, name);
  }

  // evals/config.yml
  const cfg = pkg.files.find((f) => f.path === 'evals/config.yml' || f.path === 'evals/config.yaml');
  if (cfg?.text) {
    try {
      const c = parseYaml(cfg.text) as Record<string, unknown> | null;
      if (!c || typeof c !== 'object') col.add(C, 'eval_config', 'medium', 'evals/config.yml must be a YAML mapping', { filePath: cfg.path });
      else if (c['schema_version'] !== 1) col.add(C, 'eval_config', 'medium', 'evals/config.yml: schema_version must be 1', { filePath: cfg.path, line: 1, suggestion: 'Add "schema_version: 1" at the top.' });
      else col.pass(C, 'eval_config', 'evals/config.yml is valid');
    } catch (e) {
      col.add(C, 'eval_config', 'medium', `evals/config.yml is not valid YAML: ${(e as Error).message.split('\n')[0]}`, { filePath: cfg.path });
    }
  }

  // Script coverage
  if (scripts.length) {
    if (cases.length) {
      const hay = allCaseText(cases);
      const uncovered = scripts.filter((s) => !hay.includes(basename(s.path).toLowerCase()) && !hay.includes(s.path.toLowerCase()));
      b.scriptCoverage = 15 * (1 - uncovered.length / scripts.length);
      for (const u of uncovered.slice(0, 8)) col.add(C, 'eval_script_coverage', 'low', `No eval case exercises ${u.path}`, { filePath: u.path, suggestion: `Add a case whose assertions mention ${basename(u.path)}.` });
      if (!uncovered.length) col.pass(C, 'eval_script_coverage', `All ${scripts.length} script(s) are exercised by eval cases`);
    }
  } else b.scriptCoverage = 15;

  // Trigger simulation over the case prompts (or generated ones)
  const promptSource: { prompt: string; negative: boolean }[] = (cases.length ? cases : (result.generatedDataset?.evals ?? [])).map((cs) => {
    const r = cs as RawCase;
    return { prompt: asStr(r['prompt'] ?? r['question']), negative: r['should_trigger'] === false };
  }).filter((p) => p.prompt);
  const positives = promptSource.filter((p) => !p.negative);
  result.triggers = positives.map((p) => simulateTrigger(p.prompt, index, selfIdx));
  if (cases.length && positives.length) {
    const score = result.triggers.reduce((s, t) => s + (t.verdict === 'likely' ? 1 : t.verdict === 'maybe' ? 0.5 : 0), 0) / positives.length;
    b.triggers = 10 * score;
    const weak = result.triggers.filter((t) => t.verdict === 'unlikely');
    for (const w of weak.slice(0, 5)) {
      col.add(C, 'trigger_weak', 'low', `This eval prompt shares few words with the skill description, so an agent may not pick the skill: "${clip(w.prompt, 90)}"`, {
        filePath: manifestPath, suggestion: 'Mention the user-facing task words from the prompt in the description (the "when to use" part).',
      });
    }
    const contested = result.triggers.filter((t) => t.competitor && t.verdict !== 'likely');
    for (const t of contested.slice(0, 3)) {
      col.add(C, 'trigger_competitor', 'low', `Skill '${t.competitor!.name}' matches this prompt about as well: "${clip(t.prompt, 90)}"`, { filePath: manifestPath, suggestion: 'Tighten both descriptions to separate their territory.' });
    }
  }

  const total = b.dataset + b.caseCount + b.assertions + b.scriptCoverage + b.triggers;
  result.readiness = Math.round(total);
  result.grade = scoreToGrade(result.readiness);
  result.status = ((): TierStatus => {
    if (col.findings.some((f: Finding) => f.severity === 'high' || f.severity === 'critical')) return 'fail';
    if (!dsFile || result.readiness < 70) return 'warn';
    return col.findings.some((f) => f.severity === 'medium') ? 'warn' : 'pass';
  })();
  result.findings = col.findings;
  result.passes = col.passes;
  return result;
}
