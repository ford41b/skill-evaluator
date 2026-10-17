# Design notes

**Goal:** a drag-and-drop, browser-only clone of NVIDIA SkillEvaluator's three tiers, deployable as a static site on Vercel.

**Decisions**
- Offline only (no API keys, no network). Tier 3 becomes an offline readiness check; no Skill Lift is claimed.
- Vite + TypeScript + Preact; engine in `src/core` is pure and runs in a Web Worker, with a main-thread fallback.
- Privacy is enforced, not promised: `vercel.json` sets `connect-src 'none'`; the e2e test runs under those headers and asserts no request leaves the origin.
- Findings never echo secrets: all snippets pass through `redactSecrets`.
- Untrusted input limits (`src/core/limits.ts`): file count/size, zip entry count and expanded size, dedup chunk cap; path traversal rejected on ingest.

**Flow:** drop → `readDrop` (folder entries / zip / files) → worker: `unzipToRaw` → `discoverSkills` (every dir with SKILL.md is a skill) → `evaluateSkills` (Tier 1 per skill, Tier 2 per skill + across skills, Tier 3 with a shared trigger index) → report → UI / exporters.
