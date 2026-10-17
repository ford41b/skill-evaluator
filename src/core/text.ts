const STOP = new Set((
  'a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that these those ' +
  'i me my we our you your he she they them their his her do does did done can could should would will shall may might must have has had ' +
  'not no yes so than too very just also into over under about up down out off again once here there when where why how what which who whom ' +
  'any all each few more most other some such only own same s t use used using skill skills please help need want like get make let ' +
  'one two new via per etc ie eg'
).split(' '));

/** Very light stemmer: enough to match "converts"/"conversion"/"converting". */
export function stem(word: string): string {
  let w = word.toLowerCase();
  const rules: [RegExp, string][] = [[/ies$/, 'y'], [/(ations?|ings?|ions?|ers?|ed|es|ly|s)$/, '']];
  for (const [re, rep] of rules) {
    const next = w.replace(re, rep);
    if (next.length >= 3) { w = next; break; }
  }
  return w;
}

export function tokenize(text: string, opts: { keepStop?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || /^\d+$/.test(raw)) continue;
    if (!opts.keepStop && STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** True when two stems are the same word-ish ("conver" ~ "convert"). */
export function termsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  if (m < 5) return false;
  let i = 0;
  while (i < m && a[i] === b[i]) i++;
  return i >= Math.max(5, Math.ceil(m * 0.8));
}

export type Vec = Map<string, number>;

/** Term-frequency vector over unigrams and bigrams (sublinear tf). */
export function termCounts(text: string): Map<string, number> {
  const toks = tokenize(text);
  const counts = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    counts.set(toks[i], (counts.get(toks[i]) ?? 0) + 1);
    if (i + 1 < toks.length) {
      const bg = toks[i] + ' ' + toks[i + 1];
      counts.set(bg, (counts.get(bg) ?? 0) + 1);
    }
  }
  return counts;
}

export interface TfIdfModel {
  vectors: Vec[];
  norms: number[];
}

export function buildTfIdf(docs: string[]): TfIdfModel {
  const counts = docs.map(termCounts);
  const df = new Map<string, number>();
  for (const c of counts) for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const vectors: Vec[] = [];
  const norms: number[] = [];
  for (const c of counts) {
    const v: Vec = new Map();
    let sq = 0;
    for (const [t, f] of c) {
      const w = (1 + Math.log(f)) * (Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1);
      v.set(t, w);
      sq += w * w;
    }
    vectors.push(v);
    norms.push(Math.sqrt(sq));
  }
  return { vectors, norms };
}

export function cosine(model: TfIdfModel, i: number, j: number): number {
  const a = model.vectors[i];
  const b = model.vectors[j];
  if (!model.norms[i] || !model.norms[j]) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const o = big.get(t);
    if (o !== undefined) dot += w * o;
  }
  return dot / (model.norms[i] * model.norms[j]);
}

export function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
