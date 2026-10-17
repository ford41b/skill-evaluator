import { parseManifest, str } from '../frontmatter';
import type { Severity, SkillPackage } from '../types';
import { clip, findManifest, lineAt, lineText, luhn, scannableFiles } from '../util';
import type { Collector } from './ctx';

interface PiiPattern {
  id: string;
  re: RegExp;
  severity: Severity;
  desc: string;
  suggestion: string;
  exceptions?: string[];
  /** Extra validation on the match; return false to drop it. */
  accept?: (m: RegExpExecArray, line: string) => boolean;
}

const PLACEHOLDER_USERS = /^(user|users|username|you|me|name|yourname|your-name|your_name|john|jane|johndoe|jdoe|alice|bob|example|foo|bar|someone|admin|runner|ubuntu|root|home|\.\.\.)$/i;

const PATTERNS: PiiPattern[] = [
  {
    id: 'personal-path-macos', re: /\/Users\/([^/\s]+)\//g, severity: 'high', desc: 'Personal macOS user path',
    suggestion: 'Use a generic path like /path/to/file or $HOME.',
    exceptions: ['/users/:', '/users/{', '/Users/:', '/Users/{', 'GET /users', 'POST /users', 'PUT /users', 'PATCH /users', 'DELETE /users', 'api/users'],
    accept: (m) => !PLACEHOLDER_USERS.test(m[1]) && !/^[<{$:]/.test(m[1]),
  },
  {
    id: 'personal-path-windows', re: /[A-Z]:\\Users\\([^\\\s]+)/g, severity: 'high', desc: 'Personal Windows user path',
    suggestion: 'Use a generic path like C:\\path\\to\\file or %USERPROFILE%.',
    accept: (m) => !PLACEHOLDER_USERS.test(m[1]) && !/^[<{%$]/.test(m[1]),
  },
  {
    id: 'email', re: /[A-Za-z0-9._%+-]+@(?!(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|test\.com|odata\.))[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    severity: 'high', desc: 'Non-placeholder email address', suggestion: 'Remove it or use a placeholder like user@example.com.',
    exceptions: ['Copyright', 'copyright', 'LICENSE', 'license', '(c)', 'Authors', '://', '@odata.', 'author:', 'Author:'],
    accept: (m) => !/\.(png|jpg|jpeg|gif|svg|webp|css|js|ts)$/i.test(m[0]) && !/^[\w.-]+@\d/.test(m[0]),
  },
  {
    id: 'phone-us', re: /(?<![\w.-])\d{3}[-.]\d{3}[-.]\d{4}(?![\w.-])/g, severity: 'medium', desc: 'US phone number pattern',
    suggestion: 'Remove it or use a placeholder like 555-555-5555.', exceptions: ['pageId=', 'http://', 'https://', '?id=', '&id=', 'Id='],
    accept: (m) => !m[0].includes('555'),
  },
  {
    id: 'phone-intl', re: /(?<![\w.+-])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}(?![\w])/g, severity: 'medium', desc: 'International phone number',
    suggestion: 'Remove it or use a placeholder like +1-555-555-5555.', exceptions: ['http://', 'https://', 'pageId='],
    accept: (m) => m[0].replace(/\D/g, '').length >= 10 && !m[0].includes('555'),
  },
  {
    id: 'ssn', re: /\b(\d{3})-(\d{2})-(\d{4})\b/g, severity: 'critical', desc: 'Social Security Number',
    suggestion: 'Remove it immediately — use XXX-XX-XXXX if a placeholder is needed.',
    accept: (m) => m[1] !== '000' && m[1] !== '666' && m[1][0] !== '9' && m[2] !== '00' && m[3] !== '0000',
  },
  {
    id: 'ip-address', re: /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d]|\.\d)/g, severity: 'medium', desc: 'Public IP address',
    suggestion: 'Use a private (10.x / 192.168.x) or documentation (203.0.113.x) address, or 0.0.0.0.',
    accept: (m, line) => {
      const o = [m[1], m[2], m[3], m[4]].map(Number);
      if (o.some((n) => n > 255) || [m[1], m[2], m[3], m[4]].some((s) => s.length > 1 && s[0] === '0')) return false;
      if (o[0] === 10 || o[0] === 127 || o[0] === 0 || o[0] === 255) return false;
      if (o[0] === 192 && o[1] === 168) return false;
      if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false;
      if (o[0] === 169 && o[1] === 254) return false;
      if ((o[0] === 192 && o[1] === 0 && o[2] === 2) || (o[0] === 198 && o[1] === 51 && o[2] === 100) || (o[0] === 203 && o[1] === 0 && o[2] === 113)) return false;
      if (/\b(version|ver\.?|v\d|release|chrome|firefox|safari|python|node|npm|pip|==|>=|<=|~=)\b/i.test(line)) return false;
      return true;
    },
  },
  {
    id: 'db-credentials', re: /\b(?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^:\s/]+:[^@\s]+@[^/\s]+/g, severity: 'critical',
    desc: 'Database connection string with credentials', suggestion: 'Use an environment variable like $DATABASE_URL.',
    accept: (m) => !/:(password|pass|pwd|secret|\*+|<[^>]+>|\$\{?\w+\}?|xxx+|changeme|\{\w+\})@/i.test(m[0].slice(m[0].indexOf('://') + 3).replace(/^[^:]+/, '')),
  },
  { id: 'jdbc', re: /jdbc:[a-z]+:\/\/[^:\s]+:\d+\/[a-z0-9_-]+/gi, severity: 'high', desc: 'JDBC connection string', suggestion: 'Move it to an environment variable.', exceptions: ['localhost', '127.0.0.1', 'example'] },
  {
    id: 'aws-arn', re: /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[a-z0-9\-/_:*]+/g, severity: 'medium', desc: 'AWS ARN (may expose infrastructure)',
    suggestion: 'Use a placeholder ARN or an environment variable.', accept: (m) => !/123456789012|000000000000/.test(m[0]),
  },
  {
    id: 'credit-card', re: /(?<![\d.])\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, severity: 'critical', desc: 'Possible credit card number',
    suggestion: 'Remove it — use a test number like 4111-1111-1111-1111 if needed.',
    exceptions: ['example', 'placeholder', 'mock', 'fake', 'dummy', 'test card', 'test number', 'for testing', '4111111111111111', '4111-1111-1111-1111', '5500000000000004', '5500-0000-0000-0004', '378282246310005', 'agent-browser', 'fill @'],
    accept: (m) => luhn(m[0]),
  },
  {
    id: 'bitcoin', re: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, severity: 'low', desc: 'Possible Bitcoin address',
    suggestion: 'Remove personal wallet addresses unless intentionally public.',
    accept: (m, line) => /\d/.test(m[0]) && /[a-z]/.test(m[0]) && /[A-Z]/.test(m[0]) && !/https?:\/\/\S*[a-zA-Z0-9]{25}/.test(line) && !/\/|_|-/.test(line.slice(Math.max(0, line.indexOf(m[0]) - 1), line.indexOf(m[0]))),
  },
  { id: 'ethereum', re: /\b0x[a-fA-F0-9]{40}\b/g, severity: 'medium', desc: 'Ethereum address', suggestion: 'Remove personal wallet addresses unless intentionally public.', accept: (m) => !/^0x0{40}$/.test(m[0]) && !/^0x(.)\1+$/.test(m[0]) },
  {
    id: 'mac-address', re: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, severity: 'low', desc: 'MAC address (hardware identifier)',
    suggestion: 'Use 00:00:00:00:00:00 as a placeholder.', accept: (m) => !/^(00[:-]){5}00$/.test(m[0]) && !/^(ff[:-]){5}ff$/i.test(m[0]),
  },
  {
    id: 'gps', re: /[-+]?(?:[1-8]?\d\.\d{4,}|90\.0+)[,\s]+[-+]?(?:180\.0+|(?:1[0-7]\d|[1-9]?\d)\.\d{4,})/g, severity: 'medium', desc: 'GPS coordinates (location information)',
    suggestion: 'Remove location data or use non-sensitive coordinates like 0.0, 0.0.',
    exceptions: ['%', 'createCanvas', 'Canvas(', 'viewport', '--', 'width:', 'height:', 'size(', 'resize(', 'dimensions', ' words', ' characters', ' lines', 'version', 'np.array', 'torch.tensor', 'range(', 'float(', ': float', 'return [', 'score', 'temperature', 'embedding'],
  },
];

function isMarkdown(path: string): boolean {
  return /\.(md|mdc)$/i.test(path);
}

/** Usernames that would identify the skill's author (home-path check is identity-based, as in NVIDIA's tool). */
function protectedUsernames(pkg: SkillPackage): Set<string> {
  const names = new Set<string>();
  const manifest = findManifest(pkg);
  if (!manifest?.text) return names;
  const fm = parseManifest(manifest.text);
  const meta = fm.data?.['metadata'];
  const author = str((meta && typeof meta === 'object' ? (meta as Record<string, unknown>)['author'] : '') as unknown).trim();
  if (!author) return names;
  const email = /<([^>@]+)@/.exec(author)?.[1];
  if (email) names.add(email.toLowerCase());
  const nm = author.replace(/<.*$/, '').trim().toLowerCase();
  if (nm) {
    names.add(nm.replace(/\s+/g, ''));
    names.add(nm.replace(/\s+/g, '-'));
    names.add(nm.replace(/\s+/g, '_'));
    names.add(nm.replace(/\s+/g, '.'));
    const parts = nm.split(/\s+/);
    if (parts.length > 1) names.add(parts[0][0] + parts[parts.length - 1]);
  }
  return names;
}

export function validatePii(pkg: SkillPackage, c: Collector): void {
  const C = 'PII';
  const files = scannableFiles(pkg);
  const mine = protectedUsernames(pkg);
  let found = 0;
  const seen = new Set<string>();
  const report = (p: { id: string; severity: Severity; desc: string; suggestion: string }, path: string, line: number, ltxt: string, extra?: string) => {
    const key = `${p.id}:${path}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    found++;
    c.add(C, p.id, p.severity, `${p.desc} in ${path}:${line}${extra ?? ''}`, { filePath: path, line, snippet: clip(ltxt, 180), suggestion: p.suggestion });
  };

  for (const f of files) {
    const text = f.text!;
    if (f.size > 400_000) continue;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = p.re.exec(text)) && guard++ < 500) {
        if (m[0].length === 0) { p.re.lastIndex++; continue; }
        const line = lineAt(text, m.index);
        const ltxt = lineText(text, line);
        if (p.exceptions?.some((e) => ltxt.includes(e))) continue;
        if (p.accept && !p.accept(m, ltxt)) continue;
        // Docs commonly show numbers in prose; keep IP/GPS/phone out of markdown tables of version numbers.
        if (isMarkdown(f.path) && (p.id === 'gps' || p.id === 'bitcoin') ) continue;
        report(p, f.path, line, ltxt);
      }
    }
    // Identity-based home path: only flag when the username is the skill author's.
    if (mine.size) {
      const re = /\/home\/([^/\s]+)\//g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (!mine.has(m[1].toLowerCase())) continue;
        const line = lineAt(text, m.index);
        report({ id: 'personal-path-linux', severity: 'high', desc: "Author's personal Linux home path", suggestion: 'Use a generic path or $HOME.' }, f.path, line, lineText(text, line));
      }
    }
  }
  if (!found) c.pass(C, 'pii', `No personal data detected in ${files.length} text file(s)`);
}
