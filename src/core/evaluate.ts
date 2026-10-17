import { parseManifest } from './frontmatter';
import { intraSkillDedup, interSkillOverlap, skillDoc, statusFromFindings } from './tier2';
import { buildTriggerIndex, evaluateTier3 } from './tier3';
import type { EvaluationReport, Progress, SkillPackage, SkillReport, Tier1Result } from './types';
import { estimateTokens, findManifest } from './util';
import { Collector } from './validators/ctx';
import { validateCodeRisk } from './validators/coderisk';
import { validateHygiene } from './validators/hygiene';
import { validateInjection } from './validators/injection';
import { validateLicense } from './validators/license';
import { validatePii } from './validators/pii';
import { scoreQuality } from './validators/quality';
import { validateSchema } from './validators/schema';
import { validateSecrets } from './validators/secrets';
import { validateUnicode } from './validators/unicode';

export const TOOL_VERSION = '0.1.0';

export function runTier1(pkg: SkillPackage): { result: Tier1Result; name: string } {
  const c = new Collector(1);
  const { name } = validateSchema(pkg, c);
  validateHygiene(pkg, c);
  validateSecrets(pkg, c);
  validatePii(pkg, c);
  validateUnicode(pkg, c);
  validateCodeRisk(pkg, c);
  validateInjection(pkg, c);
  validateLicense(pkg, c);
  const quality = scoreQuality(pkg, c);
  // The quality score already deducts for these; don't list them twice when SCHEMA reported them.
  const schemaNameIssue = c.findings.some((f) => f.category === 'SCHEMA' && f.checkName === 'frontmatter_field');
  if (schemaNameIssue) {
    c.findings = c.findings.filter((f) => !(f.category === 'QUALITY' && /^(Invalid name format|Name contains|Description contains XML|XML tags in frontmatter)/.test(f.message)));
  }
  return {
    name: name || pkg.dirName,
    result: { findings: c.findings, passes: c.passes, quality, status: statusFromFindings(c.findings) },
  };
}

/** Evaluate every skill in the set. Pure and synchronous; call it from a worker. */
export function evaluateSkills(pkgs: SkillPackage[], onProgress?: (p: Progress) => void): EvaluationReport {
  const total = pkgs.length * 3 + 1;
  let done = 0;
  const tick = (stage: string) => onProgress?.({ stage, done: ++done, total });

  const t1 = pkgs.map((p) => {
    const r = runTier1(p);
    tick(`Validating ${p.dirName}`);
    return r;
  });
  const t2 = pkgs.map((p) => {
    const r = intraSkillDedup(p);
    tick(`Checking ${p.dirName} for repeated content`);
    return r;
  });
  interSkillOverlap(pkgs, t2);
  tick('Comparing skills with each other');

  const index = buildTriggerIndex(pkgs.map((p) => {
    const d = skillDoc(p);
    const m = findManifest(p);
    const fm = m?.text ? parseManifest(m.text) : null;
    return { name: String(fm?.data?.['name'] ?? p.dirName), desc: d.desc, body: d.body };
  }));
  const skills: SkillReport[] = pkgs.map((p, i) => {
    const tier3 = evaluateTier3(p, t1[i].name, index, i);
    tick(`Checking ${p.dirName} for eval readiness`);
    const manifest = findManifest(p);
    return {
      name: t1[i].name,
      dirName: p.dirName,
      files: p.files,
      tier1: t1[i].result,
      tier2: t2[i],
      tier3,
      passed: t1[i].result.status !== 'fail' && t2[i].status !== 'fail',
      tokenCount: manifest?.text ? estimateTokens(manifest.text) : 0,
    };
  });
  return { generatedAt: new Date().toISOString(), toolVersion: TOOL_VERSION, skills };
}
