import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { SkillReport } from '../core/types';
import { allFindings } from '../core/report';
import { FindingCard } from './Findings';

const MAX_LINES = 2500;

export function FilesPanel({ s, selected, line, onSelect }: { s: SkillReport; selected: string | null; line?: number; onSelect: (path: string, line?: number) => void }) {
  const findings = useMemo(() => allFindings(s), [s]);
  const byFile = useMemo(() => {
    const m = new Map<string, typeof findings>();
    for (const f of findings) if (f.filePath) m.set(f.filePath, [...(m.get(f.filePath) ?? []), f]);
    return m;
  }, [findings]);
  const path = selected && s.files.some((f) => f.path === selected) ? selected : (s.files.find((f) => f.path.toLowerCase() === 'skill.md') ?? s.files[0])?.path;
  const file = s.files.find((f) => f.path === path);
  const lines = useMemo(() => (file?.text ?? '').split('\n'), [file]);
  const fileFindings = byFile.get(path ?? '') ?? [];
  const flagged = useMemo(() => {
    const m = new Map<number, 'high' | 'low'>();
    for (const f of fileFindings) if (f.line) m.set(f.line, f.severity === 'critical' || f.severity === 'high' ? 'high' : m.get(f.line) ?? 'low');
    return m;
  }, [fileFindings]);
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' });
  }, [path, line]);

  const worst = (p: string) => {
    const fs = byFile.get(p) ?? [];
    return fs.some((f) => f.severity === 'critical') ? 'critical' : fs.some((f) => f.severity === 'high') ? 'high' : '';
  };

  return (
    <div class="files">
      <nav class="card tree" aria-label="Files in this skill">
        {s.files.map((f) => (
          <button key={f.path} aria-current={f.path === path} onClick={() => onSelect(f.path)}>
            <span class="fn" title={f.path}>{f.path}</span>
            {byFile.get(f.path) && <span class={`n ${worst(f.path)}`}>{byFile.get(f.path)!.length}</span>}
          </button>
        ))}
      </nav>
      <section class="card viewer">
        {file ? (
          <>
            <header><span>{file.path}</span><span style={{ color: 'var(--muted)' }}>{(file.size / 1024).toFixed(1)} KB</span></header>
            {file.text === null ? (
              <div class="empty">{file.binary ? 'Binary file — not shown.' : 'File is larger than 1 MB — not scanned or shown.'}</div>
            ) : (
              <div class="code" tabIndex={0}>
                {lines.slice(0, MAX_LINES).map((t, i) => {
                  const n = i + 1;
                  const fl = flagged.get(n);
                  return (
                    <div key={n} ref={n === line ? focusRef : undefined} class={`ln ${fl === 'high' ? 'flag' : fl ? 'flag-low' : ''} ${n === line ? 'focus' : ''}`}>
                      <span>{n}</span><span>{t || ' '}</span>
                    </div>
                  );
                })}
                {lines.length > MAX_LINES && <div class="note">Showing the first {MAX_LINES} of {lines.length} lines.</div>}
              </div>
            )}
            {fileFindings.length > 0 && (
              <div class="file-findings">
                {fileFindings.slice(0, 20).map((f) => <FindingCard key={f.id} f={f} onOpenFile={(p, l) => onSelect(p, l)} />)}
              </div>
            )}
          </>
        ) : <div class="empty">No files.</div>}
      </section>
    </div>
  );
}
