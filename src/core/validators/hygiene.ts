import type { SkillPackage } from '../types';
import { basename, ext, isExcludedPath, markdownLinks, resolveLocalLink } from '../util';
import type { Collector } from './ctx';

const BANNED_PACKAGES = new Set(['subprocess32', 'pycrypto']);
const TEST_FILE_RE = /^(test_.*\.py|.*_test\.py|.*\.test\.[jt]sx?|.*\.spec\.[jt]sx?)$/;

/** Dead links, dependency hygiene, and test discovery. */
export function validateHygiene(pkg: SkillPackage, c: Collector): void {
  const C = 'HYGIENE';
  const allPaths = new Set(pkg.files.map((f) => f.path));
  const dirs = new Set<string>();
  for (const p of allPaths) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const exists = (p: string) => allPaths.has(p) || dirs.has(p);

  const mdFiles = pkg.files.filter((f) => f.text !== null && ext(f.path) === '.md' && !isExcludedPath(f.path));
  let dead = 0;
  for (const f of mdFiles) {
    const seen = new Set<string>();
    for (const { href, line } of markdownLinks(f.text!)) {
      const key = href;
      if (seen.has(key)) continue;
      seen.add(key);
      const target = resolveLocalLink(f.path, href);
      if (target === undefined) continue;
      const lineTxt = f.text!.split('\n')[line - 1]?.trim();
      if (target === null) {
        dead++;
        c.add(C, 'dead_links', 'medium', `Invalid local link '${href}' (absolute path or leaves the skill folder)`, {
          filePath: f.path, line, snippet: lineTxt, suggestion: 'Use a relative path inside the skill, e.g. references/guide.md.',
        });
      } else if (!exists(target)) {
        dead++;
        const near = [...allPaths].find((p) => basename(p).toLowerCase() === basename(target).toLowerCase());
        c.add(C, 'dead_links', 'medium', `Dead link: '${href}' points to a file that isn't in this skill`, {
          filePath: f.path, line, snippet: lineTxt,
          suggestion: near ? `Did you mean '${near}'?` : 'Add the file or fix the path. Agents will fail to load missing references.',
        });
      }
    }
  }
  if (dead === 0) c.pass(C, 'dead_links', mdFiles.length ? `All relative links valid in ${mdFiles.length} markdown file(s)` : 'No markdown files found to check for links');

  // --- dependencies ---
  const reqs = pkg.files.filter((f) => f.text !== null && /^requirements[^/]*\.txt$/i.test(basename(f.path)) && !isExcludedPath(f.path));
  if (pkg.files.some((f) => basename(f.path) === 'pyproject.toml')) c.pass(C, 'pyproject_toml', 'Found pyproject.toml — dependencies managed by uv/pip');
  else if (!reqs.length) c.pass(C, 'dependencies', 'No dependency files to audit');
  let depProblems = 0;
  for (const f of reqs) {
    f.text!.split('\n').forEach((raw, i) => {
      const ln = raw.trim();
      if (!ln || ln.startsWith('#') || ln.startsWith('-')) return;
      const m = /^([A-Za-z0-9_.-]+)/.exec(ln);
      if (!m) return;
      const pkgName = m[1].toLowerCase();
      const logical = ln.split(/\s+#/)[0].split(';')[0];
      const direct = /@\s*\S/.test(logical);
      if (BANNED_PACKAGES.has(pkgName)) {
        depProblems++;
        c.add(C, 'dependency_audit', 'high', `Banned package: ${pkgName}`, {
          filePath: f.path, line: i + 1, snippet: ln, suggestion: pkgName === 'pycrypto' ? 'pycrypto is unmaintained; use pycryptodome.' : 'Use the standard library subprocess instead.',
        });
      } else if (!direct && !/[=<>!~]/.test(logical)) {
        depProblems++;
        c.add(C, 'dependency_audit', 'low', `Unpinned dependency: ${ln}`, {
          filePath: f.path, line: i + 1, snippet: ln, suggestion: `Pin a version, e.g. ${pkgName}==1.2.3, so runs are reproducible.`,
        });
      }
    });
  }
  if (reqs.length && depProblems === 0) c.pass(C, 'dependency_audit', `${reqs.map((r) => basename(r.path)).join(', ')} passed dependency audit`);

  // --- tests ---
  const tests = pkg.files.filter((f) => !isExcludedPath(f.path) && (TEST_FILE_RE.test(basename(f.path)) || f.path.startsWith('tests/')));
  const hasScripts = pkg.files.some((f) => /^(scripts|tools)\//.test(f.path));
  if (tests.length) c.pass(C, 'test_discovery', `Found ${tests.length} test file(s)`);
  else if (hasScripts) c.add(C, 'test_discovery', 'info', 'No test files found for the bundled scripts', {
    suggestion: 'Optional: add tests/test_*.py so script behavior is verifiable.',
  });
}
