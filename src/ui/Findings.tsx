import { useMemo, useState } from 'preact/hooks';
import type { CheckPass, Finding, Severity } from '../core/types';
import { SEVERITIES } from '../core/types';
import { bySeverity, countBySeverity } from '../core/report';

export const SEV_COLOR: Record<Severity, string> = {
  critical: 'var(--sev-critical)', high: 'var(--sev-high)', medium: 'var(--sev-medium)', low: 'var(--sev-low)', info: 'var(--sev-info)',
};

export function SeverityCounts({ findings }: { findings: Finding[] }) {
  const counts = countBySeverity(findings);
  return (
    <>
      {SEVERITIES.map((s) => (
        <span key={s} class={`sev-count ${counts[s] ? '' : 'zero'}`} title={`${counts[s]} ${s}`}>
          <i style={{ background: SEV_COLOR[s] }} />
          {counts[s]} {s}
        </span>
      ))}
    </>
  );
}

export interface OpenFile { (path: string, line?: number): void }

export function FindingCard({ f, onOpenFile }: { f: Finding; onOpenFile?: OpenFile }) {
  return (
    <article class={`finding ${f.severity}`}>
      <div class="head">
        <span class={`sev-badge ${f.severity}`}>{f.severity}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div class="msg">{f.message}</div>
          {(f.filePath || f.data?.['other']) && (
            <div class="where">
              {f.filePath && onOpenFile && (
                <button class="linkish" onClick={() => onOpenFile(f.filePath!, f.line)} title="Open this file at that line">
                  {f.filePath}{f.line ? `:${f.line}` : ''}
                </button>
              )}
              {f.filePath && !onOpenFile && <code>{f.filePath}{f.line ? `:${f.line}` : ''}</code>}
              {typeof f.data?.['other'] === 'object' && f.data['other'] !== null && (
                <span>
                  also in <code>{(f.data['other'] as { path: string }).path}:{(f.data['other'] as { line: number }).line}</code>
                </span>
              )}
            </div>
          )}
        </div>
        <span class="cat">{f.category.replace('_', ' ')}</span>
      </div>
      {f.snippet && <pre class="snippet mono">{f.snippet}</pre>}
      {f.suggestion && (
        <div class="fix">
          <b>Fix</b>
          <span>{f.suggestion}</span>
        </div>
      )}
    </article>
  );
}

const PAGE = 40;

export function FindingsList({ findings, passes, onOpenFile, emptyText }: { findings: Finding[]; passes?: CheckPass[]; onOpenFile?: OpenFile; emptyText?: string }) {
  const [hidden, setHidden] = useState<Set<Severity>>(new Set());
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const counts = countBySeverity(findings);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...findings]
      .sort(bySeverity)
      .filter((f) => !hidden.has(f.severity))
      .filter((f) => !needle || `${f.message} ${f.category} ${f.checkName} ${f.filePath ?? ''} ${f.suggestion ?? ''}`.toLowerCase().includes(needle));
  }, [findings, hidden, q]);

  const toggle = (s: Severity) => {
    const n = new Set(hidden);
    n.has(s) ? n.delete(s) : n.add(s);
    setHidden(n);
  };

  return (
    <div class="panel">
      {findings.length > 0 && (
        <div class="toolbar">
          {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
            <button key={s} class="chip" aria-pressed={!hidden.has(s)} onClick={() => toggle(s)}>
              <i style={{ background: SEV_COLOR[s] }} /> {s} {counts[s]}
            </button>
          ))}
          <input class="search" type="search" placeholder="Filter findings…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Filter findings" />
        </div>
      )}
      {findings.length === 0 ? (
        <div class="card empty"><b>✓ Nothing to fix here.</b><div>{emptyText ?? 'No findings in this section.'}</div></div>
      ) : visible.length === 0 ? (
        <div class="card empty">No findings match your filters.</div>
      ) : (
        <div class="finding-list">
          {visible.slice(0, limit).map((f) => <FindingCard key={f.id} f={f} onOpenFile={onOpenFile} />)}
          {visible.length > limit && <button class="btn" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, visible.length - limit)} more ({visible.length - limit} hidden)</button>}
        </div>
      )}
      {passes && passes.length > 0 && (
        <details class="passed card pad">
          <summary>{passes.length} checks passed</summary>
          <ul>{passes.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
