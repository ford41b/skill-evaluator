# Skill Evaluator (browser edition)

Drag & drop an [agent skill](https://agentskills.io/) folder (or a `.zip`, or a folder of many skills) and get a quality grade, safety scan, duplicate detection and eval-readiness report — **entirely in your browser**. Nothing is uploaded; the deployed site ships a Content-Security-Policy with `connect-src 'none'`, so the page *cannot* send your files anywhere.

It is a browser-only re-imagining of [NVIDIA SkillEvaluator](https://github.com/NVIDIA/SkillEvaluator) (Apache-2.0), keeping its three-tier structure:

| Tier | Question | What runs here |
| --- | --- | --- |
| **1 · Validation** | Well-formed and safe? | Frontmatter schema & naming, structure, dead links, dependency hygiene, secrets, PII, hidden Unicode, risky code, prompt-injection patterns, license, and the 4-dimension A–F quality score (Correctness 35 %, Discoverability 25 %, Reliability 25 %, Efficiency 15 %) |
| **2 · Deduplication** | Anything repeated? | Repeated blocks inside a skill; overlap and name collisions *between* skills when you drop several |
| **3 · Eval readiness** | Could it be tested properly? | Validates `evals/evals.json` (agentskills.io and legacy formats), generates a starter dataset, script-coverage check, and a trigger playground |

Exports: standalone HTML, Markdown, JSON, SARIF.

## What differs from NVIDIA's tool (read this)

This runs offline, so some things are necessarily different:

- **No live agent runs / no Skill Lift.** NVIDIA's Tier 3 runs an agent in Docker with and without the skill. A browser can't. Tier 3 here is an *offline readiness* check and never reports a Skill Lift number.
- **No LLM rubric, no embeddings.** Checks are deterministic. Deduplication uses lexical TF-IDF similarity, so it catches copy-paste and near-copies but not paraphrases.
- **Pattern-based security scan.** Semgrep, Gitleaks and SkillSpector are replaced by regex/heuristic equivalents (ported rules plus a few extras). Treat results as a fast first pass, not a guarantee. Any secret-like string is masked in every finding snippet and export.
- A few rules are deliberately a little different: `version` may live at the top level or under `metadata`; reserved words are matched on any non-alphanumeric separator; the home-path PII check is keyed to the skill's declared author.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the engine (Vitest)
npm run test:e2e   # builds, then drives the built site in Chromium under the production CSP
npm run build      # type-check + production build into dist/
```

`test:e2e` needs a Chromium; it looks in `$CHROMIUM_PATH`, then `$PLAYWRIGHT_BROWSERS_PATH`, then `~/.cache/ms-playwright`.

## Deploy on Vercel

Import the repo in Vercel — `vercel.json` already sets the framework (Vite), build command, output directory and security headers. No environment variables, no serverless functions.

## Layout

```
src/core/        pure TypeScript engine (no DOM): ingest, validators/, tier2, tier3, report/
src/worker.ts    runs the engine off the main thread
src/ui/          Preact components (drop zone, results, findings, file viewer)
src/examples/    sample skills for the "Try an example" buttons
tests/           Vitest suite + Playwright e2e script
```

Licensed under Apache-2.0; see `LICENSE` and `NOTICE`.
