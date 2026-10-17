import { useMemo, useState } from 'preact/hooks';
import { parseManifest } from '../core/frontmatter';
import { buildTriggerIndex, simulateTrigger } from '../core/tier3';
import { tokenize, termsMatch } from '../core/text';
import type { EvaluationReport, SkillReport } from '../core/types';
import { findManifest } from '../core/util';
import { download } from './download';
import { DownloadIcon } from './icons';
import { Gauge, tone } from './Gauge';
import { FindingsList } from './Findings';
import type { OpenFile } from './Findings';

const DIM_HELP: Record<string, string> = {
  correctness: 'Structure, frontmatter and skill-type rules',
  discoverability: 'Can an agent find and pick this skill?',
  reliability: 'Error handling, prerequisites, troubleshooting',
  efficiency: 'Token budget and clarity of instructions',
};

export function Tier1Panel({ s, onOpenFile }: { s: SkillReport; onOpenFile: OpenFile }) {
  const q = s.tier1.quality;
  return (
    <div class="panel">
      <div class="panel-note">
        Tier 1 checks that the skill is well-formed and safe: schema, naming, links, secrets, personal data, hidden characters, risky code, prompt-injection patterns, licensing, and a 4-part quality score.
        Security checks are pattern-based approximations of NVIDIA's Semgrep / Gitleaks / SkillSpector scans.
      </div>
      {q && (
        <div class="card pad">
          <div class="section-title">Quality score <span class="count-badge">{q.skillType}</span></div>
          <div class="dims">
            {Object.values(q.dimensions).map((d) => (
              <div class="dim" key={d.name}>
                <div class="top">{d.name}<span>{Math.round(d.weight * 100)}% weight</span></div>
                <div class="meter" role="meter" aria-valuenow={Math.round(d.score)} aria-valuemin={0} aria-valuemax={100}><i class={tone(d.score)} style={{ width: `${d.score}%` }} /></div>
                <small>{Math.round(d.score)}/100 · {DIM_HELP[d.name]}</small>
              </div>
            ))}
          </div>
        </div>
      )}
      <FindingsList findings={s.tier1.findings} passes={s.tier1.passes} onOpenFile={onOpenFile} emptyText="Every Tier 1 check passed." />
    </div>
  );
}

export function Tier2Panel({ s, multi, onOpenFile }: { s: SkillReport; multi: boolean; onOpenFile: OpenFile }) {
  const t = s.tier2;
  return (
    <div class="panel">
      <div class="panel-note">
        Tier 2 looks for repeated or overlapping guidance — inside this skill{multi ? ' and across the skills you dropped' : ''}. Matching here is <b>lexical</b> (TF-IDF word overlap), not semantic embeddings, so it catches copy-paste and near-copies but not paraphrases.
        {!multi && ' Drop several skills together to also compare them against each other.'}
      </div>
      {t.duplicates.length > 0 && (
        <div class="card pad">
          <div class="section-title">Repeated content inside this skill</div>
          <div style={{ display: 'grid', gap: '16px' }}>
            {t.duplicates.slice(0, 8).map((d, i) => (
              <div key={i}>
                <div style={{ marginBottom: '6px' }}><span class="sim-pill">{Math.round(d.similarity * 100)}% similar</span></div>
                <div class="dup">
                  {[d.a, d.b].map((x, k) => (
                    <div class="col" key={k}>
                      <header><button class="linkish" onClick={() => onOpenFile(x.path, x.startLine)}>{x.path}:{x.startLine}</button></header>
                      <pre>{x.text}</pre>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {multi && (
        <div class="card pad">
          <div class="section-title">Overlap with other skills</div>
          {t.overlaps.length === 0 ? (
            <div class="empty"><b>✓</b> No other skill is more than 50% similar to this one.</div>
          ) : t.overlaps.map((o) => (
            <div class="overlap-row" key={o.other}>
              <b>{o.other}</b>
              <div class="meter" style={{ margin: 0 }}><i class={o.similarity >= 0.75 ? 'bad' : o.similarity >= 0.6 ? 'mid' : 'good'} style={{ width: `${Math.round(o.similarity * 100)}%` }} /></div>
              <span class="mono">{Math.round(o.similarity * 100)}%</span>
            </div>
          ))}
        </div>
      )}
      <FindingsList findings={t.findings} passes={t.passes} onOpenFile={onOpenFile} emptyText="No repeated or overlapping content found." />
    </div>
  );
}

function Highlighted({ text, stems }: { text: string; stems: string[] }) {
  const parts = text.split(/([A-Za-z0-9]+)/);
  return (
    <>
      {parts.map((p, i) => (/^[A-Za-z0-9]+$/.test(p) && tokenize(p).some((t) => stems.some((s) => termsMatch(t, s))) ? <mark key={i} class="t">{p}</mark> : p))}
    </>
  );
}

function buildIndex(report: EvaluationReport) {
  return buildTriggerIndex(report.skills.map((sk) => {
    const m = findManifest({ id: sk.dirName, dirName: sk.dirName, rootPath: '', files: sk.files });
    const fm = m?.text ? parseManifest(m.text) : null;
    return { name: sk.name, desc: String(fm?.data?.['description'] ?? ''), body: fm?.body ?? '' };
  }));
}

export function Tier3Panel({ report, idx, onOpenFile }: { report: EvaluationReport; idx: number; onOpenFile: OpenFile }) {
  const s = report.skills[idx];
  const t = s.tier3;
  const index = useMemo(() => buildIndex(report), [report]);
  const [text, setText] = useState('');
  const custom = useMemo(() => text.split('\n').map((l) => l.trim()).filter(Boolean).map((p) => simulateTrigger(p, index, idx)), [text, index, idx]);
  const rows = [
    ['Dataset present & valid', t.breakdown.dataset, 40],
    ['Number of cases', t.breakdown.caseCount, 20],
    ['Assertions per case', t.breakdown.assertions, 15],
    ['Script coverage', t.breakdown.scriptCoverage, 15],
    ['Trigger match', t.breakdown.triggers, 10],
  ] as const;
  const gen = t.generatedDataset;

  return (
    <div class="panel">
      <div class="panel-note">
        <b>Offline readiness, not a live run.</b> NVIDIA's Tier 3 executes an agent in a sandbox with and without your skill to measure "Skill Lift". A browser can't do that, so this tab checks what makes a live run <i>possible and meaningful</i>: a valid eval dataset, enough cases, assertions, script coverage, and whether eval prompts would plausibly trigger the skill. No Skill Lift number is produced.
      </div>
      <div class="card pad ready-grid">
        <Gauge score={t.readiness} grade={t.grade} size={120} />
        <div class="breakdown">
          {rows.map(([label, v, max]) => (
            <div class="brow" key={label}>
              <span>{label}</span>
              <div class="meter" style={{ margin: 0 }}><i class={tone((v / max) * 100)} style={{ width: `${(v / max) * 100}%` }} /></div>
              <span>{Math.round(v)}/{max}</span>
            </div>
          ))}
          <small style={{ color: 'var(--muted)' }}>
            {t.datasetPath ? `${t.caseCount} case(s) in ${t.datasetPath}${t.datasetFormat === 'legacy' ? ' (legacy format)' : ''}` : 'No evals/evals.json yet'}
          </small>
        </div>
      </div>

      <FindingsList findings={t.findings} passes={t.passes} onOpenFile={onOpenFile} emptyText="The eval setup looks solid." />

      {gen && (
        <div class="card pad">
          <div class="section-title">{t.datasetPath ? 'Suggested extra cases' : 'Starter eval dataset'}</div>
          <p style={{ color: 'var(--muted)', fontSize: '13.5px', marginBottom: '10px' }}>
            Generated from your SKILL.md: a prompt from each documented command, an error case, and a negative control. Review and edit before using — these give limited coverage.
          </p>
          <pre class="codebox mono">{JSON.stringify(gen, null, 2)}</pre>
          <div class="row-actions">
            <button class="btn primary small" onClick={() => download('evals.json', JSON.stringify(gen, null, 2) + '\n', 'application/json')}><DownloadIcon size={16} /> Download evals.json</button>
            <button class="btn small" onClick={() => navigator.clipboard?.writeText(JSON.stringify(gen, null, 2))}>Copy</button>
          </div>
        </div>
      )}

      <div class="card pad">
        <div class="section-title">Trigger playground</div>
        <p style={{ color: 'var(--muted)', fontSize: '13.5px', marginBottom: '10px' }}>
          Type things a user might ask (one per line) to see whether the skill's name and description would plausibly match. Matched words are highlighted.
          {report.skills.length > 1 && ' Other dropped skills compete for the same prompts.'}
        </p>
        <textarea class="prompts" placeholder={'e.g.\nConvert 100 celsius to fahrenheit\nWhat is a good banana bread recipe?'} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label="Sample prompts, one per line" />
        {custom.length > 0 && <TriggerRows rows={custom} />}
        {t.triggers.length > 0 && (
          <>
            <div class="section-title" style={{ marginTop: '18px' }}>Your eval prompts</div>
            <TriggerRows rows={t.triggers} />
          </>
        )}
      </div>
    </div>
  );
}

function TriggerRows({ rows }: { rows: ReturnType<typeof simulateTrigger>[] }) {
  const label = { likely: 'Likely', maybe: 'Maybe', unlikely: 'Unlikely' } as const;
  return (
    <div style={{ marginTop: '8px' }}>
      {rows.map((r, i) => (
        <div class="trig" key={i}>
          <span class={`verdict-pill ${r.verdict}`}>{label[r.verdict]}</span>
          <div>
            <div class="p"><Highlighted text={r.prompt} stems={r.matchedTerms} /></div>
            <div class="m">
              {r.matchedTerms.length ? `Matched ${r.matchedTerms.length} term${r.matchedTerms.length > 1 ? 's' : ''}` : 'No shared terms with the description'}
              {r.competitor && <> · <b>{r.competitor.name}</b> matches {r.competitor.score >= r.score ? 'at least as well' : 'closely'}</>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
