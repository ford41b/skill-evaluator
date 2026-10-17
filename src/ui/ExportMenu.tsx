import { useEffect, useRef, useState } from 'preact/hooks';
import { toHtml, toJson, toMarkdown, toSarif } from '../core/report';
import type { EvaluationReport } from '../core/types';
import { download } from './download';
import { DownloadIcon } from './icons';

export function ExportMenu({ report }: { report: EvaluationReport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const base = report.skills.length === 1 ? report.skills[0].name : 'skill-evaluation';
  const items: [string, string, () => void][] = [
    ['HTML report', 'Self-contained page you can share', () => download(`${base}-report.html`, toHtml(report), 'text/html')],
    ['Markdown', 'Paste into a PR or issue', () => download(`${base}-report.md`, toMarkdown(report), 'text/markdown')],
    ['JSON', 'Full machine-readable results', () => download(`${base}-report.json`, toJson(report), 'application/json')],
    ['SARIF', 'For GitHub code scanning', () => download(`${base}-report.sarif`, toSarif(report), 'application/json')],
  ];
  return (
    <div class="menu-wrap" ref={ref}>
      <button class="btn primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><DownloadIcon size={18} /> Export report</button>
      {open && (
        <div class="menu" role="menu">
          {items.map(([t, d, fn]) => (
            <button key={t} role="menuitem" onClick={() => { fn(); setOpen(false); }}>{t}<small>{d}</small></button>
          ))}
        </div>
      )}
    </div>
  );
}
