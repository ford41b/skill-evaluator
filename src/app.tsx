import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { runEvaluation } from './client';
import type { InputItem } from './client';
import { EXAMPLES } from './examples';
import type { EvaluationReport, Progress } from './core/types';
import { Landing, usePickers } from './ui/Landing';
import { Results } from './ui/Results';
import { CheckIcon, LockIcon, MoonIcon, SunIcon } from './ui/icons';
import { TooManyFiles, readDataTransfer, readFileList } from './ui/readDrop';

type Phase = 'landing' | 'running' | 'results';

const key = (i: InputItem) => (i.kind === 'zip' ? `zip:${i.name}` : `file:${i.path}`);

function loadTheme(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem('theme');
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function App() {
  const [phase, setPhase] = useState<Phase>('landing');
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: 'Starting…', done: 0, total: 1 });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(loadTheme);
  const items = useRef<InputItem[]>([]);
  // Mirrors of state, updated synchronously: window-level drop handlers can fire before a re-render.
  const phaseRef = useRef<Phase>('landing');
  const reportRef = useRef<EvaluationReport | null>(null);
  const busy = useRef(false);
  const goto = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const setResult = (r: EvaluationReport | null) => { reportRef.current = r; setReport(r); };
  const dragDepth = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [theme]);

  const toggleTheme = () => {
    const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('theme', next); } catch { /* storage unavailable */ }
  };
  const isDark = theme ? theme === 'dark' : typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

  const start = useCallback(async (incoming: InputItem[], append: boolean) => {
    if (busy.current || !incoming.length) return;
    busy.current = true;
    setError(null);
    const merged = new Map<string, InputItem>();
    for (const i of append ? items.current : []) merged.set(key(i), i);
    for (const i of incoming) merged.set(key(i), i);
    const all = [...merged.values()];
    goto('running');
    setProgress({ stage: 'Reading files…', done: 0, total: 1 });
    try {
      const r = await runEvaluation(all, setProgress);
      items.current = all;
      setResult(r);
      goto('results');
    } catch (e) {
      setError((e as Error).message);
      goto(append && reportRef.current ? 'results' : 'landing');
    } finally {
      busy.current = false;
    }
  }, []);

  const guarded = async (fn: () => Promise<InputItem[]> | InputItem[], append: boolean) => {
    try {
      const got = await fn();
      if (!got.length) { setError('No files were found in what you dropped.'); return; }
      await start(got, append);
    } catch (e) {
      setError(e instanceof TooManyFiles ? 'That folder has too many files. Drop the single skill folder (the one containing SKILL.md) instead.' : `Couldn't read that: ${(e as Error).message}`);
    }
  };

  // Whole-window drag & drop, on every screen.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!e.dataTransfer) return;
      const dt = e.dataTransfer;
      void guarded(() => readDataTransfer(dt), phaseRef.current === 'results');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  });

  const onPicked = (list: FileList, append: boolean) => void guarded(() => readFileList(list), append);
  const onExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (ex) void start(ex.files().map((f) => ({ kind: 'file', path: f.path, source: f.data }) as InputItem), false);
  };
  const adder = usePickers({ onFolder: (l) => onPicked(l, true), onFiles: (l) => onPicked(l, true) });
  const reset = () => { items.current = []; setResult(null); setError(null); goto('landing'); };

  return (
    <>
      <header class="topbar">
        <button class="brand" onClick={reset} aria-label="Skill Evaluator home">
          <span class="brand-mark"><CheckIcon size={18} /></span>
          Skill Evaluator
        </button>
        <span class="spacer" />
        <span class="privacy-pill"><LockIcon size={14} /> <span class="long">Runs entirely in your browser · nothing uploaded</span><span class="short">Private</span></span>
        <button class="icon-btn" onClick={toggleTheme} aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>{isDark ? <SunIcon /> : <MoonIcon />}</button>
      </header>

      <main>
        {phase === 'landing' && (
          <Landing onFolder={(l) => onPicked(l, false)} onFiles={(l) => onPicked(l, false)} onExample={onExample} error={error} dragging={dragging} />
        )}
        {phase === 'running' && (
          <div class="running" role="status" aria-live="polite">
            <div class="spinner" />
            <h2>Evaluating…</h2>
            <div class="bar"><i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
            <p>{progress.stage}</p>
          </div>
        )}
        {phase === 'results' && report && (
          <>
            {error && <div class="dz-error" role="alert" style={{ marginBottom: '16px' }}>{error}</div>}
            <Results report={report} onReset={reset} onAddMore={adder.pickFolder} />
            {adder.inputs}
          </>
        )}
      </main>

      <footer class="footer">
        Checks are modeled on <a href="https://github.com/NVIDIA/SkillEvaluator" target="_blank" rel="noreferrer noopener">NVIDIA SkillEvaluator</a> (Apache-2.0) and re-implemented to run in the browser. Independent project — not affiliated with or endorsed by NVIDIA.
        Security and dedup checks here are pattern-based approximations; treat them as a fast first pass, not a guarantee.
      </footer>

      {dragging && <div class="drag-overlay" aria-hidden="true"><div>Drop to {phase === 'results' ? 'add to this evaluation' : 'evaluate'}</div></div>}
    </>
  );
}
