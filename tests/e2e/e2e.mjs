// End-to-end smoke test: drives the built app in Chromium under the production CSP headers.
import { chromium } from 'playwright-core';
import { zipSync, strToU8 } from 'fflate';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { serve } from '../../scripts/serve-dist.mjs';

const PORT = 4179;

/** CHROMIUM_PATH wins; otherwise look for a Playwright-installed headless shell / chromium. */
function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || `${process.env.HOME}/.cache/ms-playwright`;
  if (!existsSync(base)) return undefined;
  for (const prefix of ['chromium_headless_shell-', 'chromium-']) {
    for (const d of readdirSync(base).filter((n) => n.startsWith(prefix)).sort().reverse()) {
      for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        if (existsSync(`${base}/${d}/${rel}`)) return `${base}/${d}/${rel}`;
      }
    }
  }
  return undefined;
}
const shots = process.env.SHOTS_DIR;
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };

const server = await serve(PORT);
const browser = await chromium.launch({ executablePath: findChromium() });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
const external = [];
page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });

let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.dropzone');
  check(await page.locator('h2', { hasText: 'Drag & drop a skill folder' }).count() === 1, 'landing page renders drop zone');
  await shot(page, '01-landing');

  // 1) example button -> results
  await page.getByRole('button', { name: /A skill with problems/ }).click();
  await page.waitForSelector('.summary');
  check((await page.locator('.summary h2').innerText()).includes('Messy_Skill'), 'example evaluates and shows skill name');
  check((await page.locator('.verdict').innerText()) === 'FAIL', 'messy skill fails');
  const t1 = await page.locator('.finding.critical').count();
  check(t1 >= 3, `critical findings shown (${t1})`);
  check((await page.locator('.finding .snippet').allInnerTexts()).some((s) => s.includes('AKIA') && s.includes('••')), 'secret is masked in snippet');
  await shot(page, '02-results-messy');

  // open a finding in the file viewer
  await page.locator('.finding .linkish').first().click();
  await page.waitForSelector('.code .ln.focus, .code .ln.flag');
  check(await page.locator('.code .ln.flag, .code .ln.flag-low').count() > 0, 'file viewer marks flagged lines');
  await shot(page, '03-file-viewer');

  // tier 2 + 3 tabs
  await page.getByRole('tab', { name: /Tier 2/ }).click();
  check(await page.locator('.dup').count() > 0, 'tier 2 shows duplicated content side by side');
  await shot(page, '04-tier2');
  await page.getByRole('tab', { name: /Tier 3/ }).click();
  check(await page.locator('.codebox').count() > 0, 'tier 3 shows generated starter evals');
  await page.locator('textarea.prompts').fill('Help me with various things\nWhat is a good banana bread recipe?');
  check(await page.locator('.trig').count() >= 2, 'trigger playground evaluates prompts');
  await shot(page, '05-tier3');

  // export
  await page.getByRole('button', { name: /Export report/ }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /HTML report/ }).click()]);
  check(/report\.html$/.test(dl.suggestedFilename()), `HTML export downloads (${dl.suggestedFilename()})`);

  // 2) overlap example (3 skills)
  await page.getByRole('button', { name: /New evaluation/ }).click();
  await page.getByRole('button', { name: /Overlapping skills/ }).click();
  await page.waitForSelector('.sidebar .skill-item');
  check(await page.locator('.skill-item').count() === 3, 'three skills listed in sidebar');
  await page.getByRole('tab', { name: /Tier 2/ }).click();
  check(await page.locator('.overlap-row').count() >= 1, 'cross-skill overlap shown');
  await shot(page, '06-overlap');

  // 3) real folder upload via the folder input
  await page.getByRole('button', { name: /New evaluation/ }).click();
  await page.locator('input[type=file][webkitdirectory]').setInputFiles('src/examples/skills/text-analyzer');
  await page.waitForSelector('.summary');
  check((await page.locator('.summary h2').innerText()).includes('text-analyzer'), 'folder upload works');

  // 4) drag & drop a zip onto the window
  await page.getByRole('button', { name: /New evaluation/ }).click();
  const zip = zipSync({ 'my-zip-skill/SKILL.md': strToU8('---\nname: my-zip-skill\ndescription: Reverses strings. Use when asked to reverse text.\n---\n\n# Zip Skill\n\n## Instructions\n\n1. Reverse the text.\n') });
  const b64 = Buffer.from(zip).toString('base64');
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'my-zip-skill.zip', { type: 'application/zip' }));
    for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64);
  await page.waitForSelector('.summary');
  check((await page.locator('.summary h2').innerText()).includes('my-zip-skill'), 'dropping a .zip works');

  // 5) nothing useful dropped -> friendly error
  await page.getByRole('button', { name: /New evaluation/ }).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('.dz-error');
  check((await page.locator('.dz-error').innerText()).includes('SKILL.md'), 'friendly error when no SKILL.md');

  // mobile layout
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: /Overlapping skills/ }).click();
  await page.waitForSelector('.summary');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, `no horizontal scroll at 390px (overflow ${overflow}px)`);
  await shot(page, '07-mobile');

  check(external.length === 0, `no network requests leave the origin (${external.join(', ') || 'none'})`);
  check(problems.length === 0, `no console errors / CSP violations${problems.length ? ': ' + problems.join(' | ') : ''}`);
} catch (e) {
  console.error('FAIL  unexpected error:', e);
  console.error('main html:', (await page.locator('main').innerHTML().catch(() => '?')).slice(0, 600));
  console.error(problems.join('\n'));
  await shot(page, 'error');
  failed++;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
