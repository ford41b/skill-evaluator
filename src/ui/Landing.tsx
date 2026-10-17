import { useRef } from 'preact/hooks';
import { EXAMPLES } from '../examples';
import { FolderIcon, UploadIcon, ZipIcon } from './icons';

export interface PickHandlers {
  onFolder: (list: FileList) => void;
  onFiles: (list: FileList) => void;
  onExample: (id: string) => void;
}

/** Hidden inputs + buttons shared by the landing page and the "add more" action. */
export function usePickers(h: Pick<PickHandlers, 'onFolder' | 'onFiles'>) {
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const inputs = (
    <>
      <input ref={folderRef} type="file" hidden {...({ webkitdirectory: true } as Record<string, boolean>)} onChange={(e) => { const t = e.currentTarget; if (t.files?.length) h.onFolder(t.files); t.value = ''; }} />
      <input ref={filesRef} type="file" hidden multiple accept=".zip,.md,.py,.sh,.json,.yaml,.yml,.txt,application/zip" onChange={(e) => { const t = e.currentTarget; if (t.files?.length) h.onFiles(t.files); t.value = ''; }} />
    </>
  );
  return { inputs, pickFolder: () => folderRef.current?.click(), pickFiles: () => filesRef.current?.click() };
}

export function Landing({ onFolder, onFiles, onExample, error, dragging }: PickHandlers & { error: string | null; dragging: boolean }) {
  const { inputs, pickFolder, pickFiles } = usePickers({ onFolder, onFiles });
  return (
    <>
      <section class="hero">
        <h1>Is your agent skill any good?</h1>
        <p>Drop a skill folder and get a quality grade, a safety scan, duplicate detection and eval-readiness check in seconds. Everything runs in your browser — nothing is uploaded.</p>
      </section>

      <section class={`dropzone ${dragging ? 'over' : ''}`} aria-label="Drop zone">
        <div class="dz-icon"><UploadIcon size={34} /></div>
        <h2>Drag &amp; drop a skill folder here</h2>
        <p class="sub">…or a .zip of one. Drop a whole folder of skills to compare them against each other.</p>
        <div class="dz-actions">
          <button class="btn primary" onClick={pickFolder}><FolderIcon size={18} /> Choose folder</button>
          <button class="btn" onClick={pickFiles}><ZipIcon size={18} /> Choose zip or files</button>
        </div>
        {inputs}
        {error && <div class="dz-error" role="alert">{error}</div>}
      </section>

      <section class="examples" aria-label="Examples">
        <h3>No skill handy? Try an example</h3>
        <div class="example-grid">
          {EXAMPLES.map((ex) => (
            <button key={ex.id} class="example" onClick={() => onExample(ex.id)}>
              <b>{ex.title}</b>
              <span>{ex.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section class="tiers" aria-label="What gets checked">
        <div class="tier-card">
          <div class="tier-num">1</div>
          <h3>Validation</h3>
          <p>Is it well-formed and safe?</p>
          <ul><li>Frontmatter, naming, structure, links</li><li>Leaked secrets &amp; personal data</li><li>Hidden Unicode &amp; prompt-injection patterns</li><li>Risky code, licenses, A–F quality score</li></ul>
        </div>
        <div class="tier-card">
          <div class="tier-num">2</div>
          <h3>Deduplication</h3>
          <p>Is anything repeated?</p>
          <ul><li>Copy-pasted blocks inside a skill</li><li>Skills that overlap each other</li><li>Name collisions</li></ul>
        </div>
        <div class="tier-card">
          <div class="tier-num">3</div>
          <h3>Eval readiness</h3>
          <p>Could it be tested properly?</p>
          <ul><li>Validates <code>evals/evals.json</code></li><li>Generates starter test cases</li><li>Trigger playground for your description</li></ul>
        </div>
      </section>
    </>
  );
}
