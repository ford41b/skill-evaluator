import { useEffect, useMemo, useState } from 'preact/hooks';
import { parseManifest } from '../core/frontmatter';
import { allFindings } from '../core/report';
import type { EvaluationReport, TierStatus } from '../core/types';
import { findManifest } from '../core/util';
import { ExportMenu } from './ExportMenu';
import { FilesPanel } from './FilesPanel';
import { SeverityCounts } from './Findings';
import { Gauge } from './Gauge';
import { BackIcon, PlusIcon } from './icons';
import { Tier1Panel, Tier2Panel, Tier3Panel } from './TierPanels';

type Tab = 't1' | 't2' | 't3' | 'files';

const STATUS_LABEL: Record<TierStatus, string> = { pass: 'passed', warn: 'needs attention', fail: 'failed', skipped: 'skipped' };

export function Results({ report, onReset, onAddMore }: { report: EvaluationReport; onReset: () => void; onAddMore: () => void }) {
  const [idx, setIdx] = useState(0);
  const [tab, setTab] = useState<Tab>('t1');
  const [focus, setFocus] = useState<{ path: string | null; line?: number }>({ path: null });
  const multi = report.skills.length > 1;
  const safeIdx = Math.min(idx, report.skills.length - 1);
  const s = report.skills[safeIdx];

  useEffect(() => {
    setIdx(0);
    setTab('t1');
    setFocus({ path: null });
  }, [report]);

  const findings = useMemo(() => allFindings(s), [s]);
  const description = useMemo(() => {
    const m = findManifest({ id: '', dirName: s.dirName, rootPath: '', files: s.files });
    return m?.text ? String(parseManifest(m.text).data?.['description'] ?? '') : '';
  }, [s]);
  const q = s.tier1.quality;
  const openFile = (path: string, line?: number) => {
    setFocus({ path, line });
    setTab('files');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const tabs: { id: Tab; label: string; status?: TierStatus; count?: number }[] = [
    { id: 't1', label: 'Tier 1 · Validation', status: s.tier1.status, count: s.tier1.findings.length },
    { id: 't2', label: 'Tier 2 · Deduplication', status: s.tier2.status, count: s.tier2.findings.length },
    { id: 't3', label: 'Tier 3 · Eval readiness', status: s.tier3.status, count: s.tier3.findings.length },
    { id: 'files', label: 'Files', count: s.files.length },
  ];

  return (
    <div class={`results ${multi ? '' : 'single'}`}>
      {multi && (
        <aside class="sidebar" aria-label="Skills">
          <h3>{report.skills.length} skills</h3>
          {report.skills.map((sk, i) => (
            <button key={i} class="skill-item" aria-current={i === safeIdx} onClick={() => { setIdx(i); setTab('t1'); setFocus({ path: null }); }}>
              <span class={`grade-chip grade-${sk.tier1.quality?.grade ?? 'F'}`}>{sk.tier1.quality?.grade ?? '–'}</span>
              <span class="grow">
                <div class="nm">{sk.name}</div>
                <div class="sm">{sk.passed ? 'Passed' : 'Failed'} · {allFindings(sk).length} findings</div>
              </span>
            </button>
          ))}
          <button class="btn small add-more" onClick={onAddMore}><PlusIcon size={16} /> Add more skills</button>
        </aside>
      )}

      <div style={{ minWidth: 0 }}>
        <div class="top-actions">
          <button class="btn ghost small" onClick={onReset}><BackIcon size={16} /> New evaluation</button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!multi && <button class="btn small" onClick={onAddMore}><PlusIcon size={16} /> Add more skills</button>}
            <ExportMenu report={report} />
          </div>
        </div>

        <section class="card summary">
          {q ? <Gauge score={q.overall} grade={q.grade} /> : <Gauge score={0} grade="F" />}
          <div style={{ minWidth: 0 }}>
            <h2>{s.name}<span class={`verdict ${s.passed ? 'pass' : 'fail'}`}>{s.passed ? 'PASS' : 'FAIL'}</span></h2>
            {description && <p class="desc">{description}</p>}
            <div class="stat-row"><SeverityCounts findings={findings} /></div>
            <div class="meta-row">
              <span>{s.files.length} files</span>
              <span>~{s.tokenCount.toLocaleString()} tokens in SKILL.md</span>
              {q && <span>{q.skillType} skill</span>}
              <span>Eval readiness {s.tier3.readiness}/100</span>
            </div>
          </div>
        </section>

        <div class="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} class="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} title={t.status ? `${t.label}: ${STATUS_LABEL[t.status]}` : t.label}>
              {t.status && <i class={`dot ${t.status}`} />}
              {t.label}
              {t.count !== undefined && <span class="count-badge">{t.count}</span>}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === 't1' && <Tier1Panel s={s} onOpenFile={openFile} />}
          {tab === 't2' && <Tier2Panel s={s} multi={multi} onOpenFile={openFile} />}
          {tab === 't3' && <Tier3Panel report={report} idx={safeIdx} onOpenFile={openFile} />}
          {tab === 'files' && <FilesPanel s={s} selected={focus.path} line={focus.line} onSelect={(path, line) => setFocus({ path, line })} />}
        </div>
      </div>
    </div>
  );
}
