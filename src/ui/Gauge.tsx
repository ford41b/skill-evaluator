import type { Grade } from '../core/types';

export const tone = (score: number): 'good' | 'mid' | 'bad' => (score >= 80 ? 'good' : score >= 60 ? 'mid' : 'bad');

export function Gauge({ score, grade, size = 120, caption = 'out of 100' }: { score: number; grade?: Grade; size?: number; caption?: string }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div class={`gauge ${tone(score)}`} style={{ width: size, height: size }} role="img" aria-label={`Score ${Math.round(score)} out of 100${grade ? `, grade ${grade}` : ''}`}>
      <svg width={size} height={size}>
        <circle class="track" cx={size / 2} cy={size / 2} r={r} fill="none" stroke-width={stroke} />
        <circle class="val" cx={size / 2} cy={size / 2} r={r} fill="none" stroke-width={stroke} stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={c * (1 - pct)} />
      </svg>
      <div class="lbl">
        <b>{grade ?? Math.round(score)}</b>
        <span>{grade ? `${Math.round(score)}/100` : caption}</span>
      </div>
    </div>
  );
}
