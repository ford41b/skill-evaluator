import type { EvaluationReport, Finding, Severity, SkillReport } from '../types';
import { SEVERITIES } from '../types';

export function allFindings(s: SkillReport): Finding[] {
  return [...s.tier1.findings, ...s.tier2.findings, ...s.tier3.findings];
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

const sevRank = (s: Severity) => SEVERITIES.indexOf(s);
export const bySeverity = (a: Finding, b: Finding) => sevRank(a.severity) - sevRank(b.severity);

// ---------------------------------------------------------------- JSON
export function toJson(report: EvaluationReport): string {
  const slim = {
    ...report,
    skills: report.skills.map((s) => ({ ...s, files: s.files.map((f) => ({ path: f.path, size: f.size, binary: f.binary })) })),
  };
  return JSON.stringify(slim, null, 2);
}

// ------------------------------------------------------------ Markdown
export function toMarkdown(report: EvaluationReport): string {
  const out: string[] = ['# Skill Evaluation Report', '', `Generated ${report.generatedAt} by Skill Evaluator (browser) v${report.toolVersion}.`, ''];
  for (const s of report.skills) {
    const q = s.tier1.quality;
    out.push(`## ${s.name}`, '', `**Result:** ${s.passed ? 'PASS' : 'FAIL'}${q ? ` · Quality ${q.overall.toFixed(1)}/100 (${q.grade})` : ''} · Readiness ${s.tier3.readiness}/100 (${s.tier3.grade})`, '');
    out.push('| Tier | Status | Findings |', '| --- | --- | --- |');
    out.push(`| 1 Validation | ${s.tier1.status} | ${s.tier1.findings.length} |`);
    out.push(`| 2 Deduplication | ${s.tier2.status} | ${s.tier2.findings.length} |`);
    out.push(`| 3 Readiness (offline) | ${s.tier3.status} | ${s.tier3.findings.length} |`, '');
    if (q) {
      out.push('| Dimension | Score | Weight |', '| --- | --- | --- |');
      for (const d of Object.values(q.dimensions)) out.push(`| ${d.name} | ${d.score.toFixed(0)} | ${Math.round(d.weight * 100)}% |`);
      out.push('');
    }
    const fs = allFindings(s).sort(bySeverity);
    if (!fs.length) out.push('_No findings._', '');
    for (const f of fs) {
      const loc = f.filePath ? ` (\`${f.filePath}${f.line ? ':' + f.line : ''}\`)` : '';
      out.push(`- **${f.severity.toUpperCase()}** [${f.category}] ${f.message}${loc}${f.suggestion ? `\n  - Fix: ${f.suggestion.replace(/\n/g, ' ')}` : ''}`);
    }
    out.push('');
  }
  return out.join('\n');
}

// --------------------------------------------------------------- SARIF
const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };

export function toSarif(report: EvaluationReport): string {
  const rules = new Map<string, { id: string; shortDescription: { text: string } }>();
  const results: unknown[] = [];
  for (const s of report.skills) {
    for (const f of allFindings(s)) {
      const id = `${f.category}/${f.checkName}`;
      if (!rules.has(id)) rules.set(id, { id, shortDescription: { text: f.checkName.replace(/[_-]/g, ' ') } });
      results.push({
        ruleId: id,
        level: LEVEL[f.severity],
        message: { text: f.message + (f.suggestion ? ` — ${f.suggestion}` : '') },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: `${s.dirName}/${f.filePath ?? 'SKILL.md'}` },
            ...(f.line ? { region: { startLine: f.line } } : {}),
          },
        }],
        properties: { severity: f.severity, tier: f.tier, skill: s.name },
      });
    }
  }
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'Skill Evaluator (browser)', version: report.toolVersion, rules: [...rules.values()] } }, results }],
  }, null, 2);
}

// ---------------------------------------------------------------- HTML
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function toHtml(report: EvaluationReport): string {
  const sections = report.skills.map((s) => {
    const q = s.tier1.quality;
    const fs = allFindings(s).sort(bySeverity);
    const counts = countBySeverity(fs);
    return `<section>
<h2>${esc(s.name)} <span class="pill ${s.passed ? 'ok' : 'bad'}">${s.passed ? 'PASS' : 'FAIL'}</span></h2>
<p class="meta">${q ? `Quality <b>${q.overall.toFixed(1)}</b>/100 (grade <b>${q.grade}</b>) · ` : ''}Eval readiness <b>${s.tier3.readiness}</b>/100 · ${s.tokenCount.toLocaleString()} tokens in SKILL.md</p>
<p class="counts">${SEVERITIES.map((v) => `<span class="sev ${v}">${counts[v]} ${v}</span>`).join(' ')}</p>
${q ? `<table><tr><th>Dimension</th><th>Score</th><th>Weight</th></tr>${Object.values(q.dimensions).map((d) => `<tr><td>${d.name}</td><td>${d.score.toFixed(0)}</td><td>${Math.round(d.weight * 100)}%</td></tr>`).join('')}</table>` : ''}
${fs.length ? `<table class="f"><tr><th>Severity</th><th>Tier</th><th>Check</th><th>Message</th><th>Location</th></tr>${fs.map((f) => `<tr><td><span class="sev ${f.severity}">${f.severity}</span></td><td>${f.tier}</td><td>${esc(f.category)}</td><td>${esc(f.message)}${f.suggestion ? `<div class="fix">Fix: ${esc(f.suggestion)}</div>` : ''}</td><td><code>${esc(f.filePath ?? '')}${f.line ? ':' + f.line : ''}</code></td></tr>`).join('')}</table>` : '<p>No findings.</p>'}
</section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skill Evaluation Report</title>
<style>
:root{--bg:#fff;--fg:#14181f;--mut:#5a6472;--line:#e3e7ee;--card:#f7f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--fg:#e8ebf1;--mut:#9aa4b2;--line:#262c38;--card:#171b23}}
body{font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:1000px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px}section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:20px 0}
.meta,.counts{color:var(--mut)}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.sev{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600;background:#8884;}
.sev.critical{background:#b91c1c;color:#fff}.sev.high{background:#dc2626;color:#fff}.sev.medium{background:#d97706;color:#fff}.sev.low{background:#64748b;color:#fff}.sev.info{background:#0369a1;color:#fff}
.pill{font-size:12px;padding:2px 10px;border-radius:99px;vertical-align:middle}.pill.ok{background:#16a34a;color:#fff}.pill.bad{background:#dc2626;color:#fff}
.fix{color:var(--mut);font-size:13px;margin-top:2px}code{font-size:12px}
</style></head><body><h1>Skill Evaluation Report</h1><p class="meta">Generated ${esc(report.generatedAt)} · Skill Evaluator (browser) v${esc(report.toolVersion)} · all analysis ran locally</p>
${sections}</body></html>`;
}
