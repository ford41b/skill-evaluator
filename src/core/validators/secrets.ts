import type { Severity, SkillPackage } from '../types';
import { clip, lineAt, lineText, scannableFiles } from '../util';
import type { Collector } from './ctx';

interface SecretRule {
  id: string;
  desc: string;
  re: RegExp;
  severity: Severity;
}

/** Provider-specific credential formats (in the spirit of the Gitleaks defaults NVIDIA uses). */
const RULES: SecretRule[] = [
  { id: 'aws-access-key', desc: 'AWS access key ID', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g, severity: 'critical' },
  { id: 'aws-secret-key', desc: 'AWS secret access key', re: /aws[_-]?secret[_-]?access[_-]?key["'\s:=]+[A-Za-z0-9/+=]{40}\b/gi, severity: 'critical' },
  { id: 'github-pat', desc: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, severity: 'critical' },
  { id: 'github-fine-grained', desc: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, severity: 'critical' },
  { id: 'gitlab-pat', desc: 'GitLab personal access token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, severity: 'critical' },
  { id: 'slack-token', desc: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, severity: 'critical' },
  { id: 'stripe-live', desc: 'Stripe live secret key', re: /\b[rs]k_live_[0-9A-Za-z]{24,}\b/g, severity: 'critical' },
  { id: 'google-api-key', desc: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: 'high' },
  { id: 'anthropic-key', desc: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: 'critical' },
  { id: 'openai-key', desc: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g, severity: 'critical' },
  { id: 'nvidia-api-key', desc: 'NVIDIA API key', re: /\bnvapi-[A-Za-z0-9_-]{40,}\b/g, severity: 'critical' },
  { id: 'huggingface-token', desc: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{34,}\b/g, severity: 'critical' },
  { id: 'npm-token', desc: 'npm access token', re: /\bnpm_[A-Za-z0-9]{36}\b/g, severity: 'critical' },
  { id: 'sendgrid-key', desc: 'SendGrid API key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, severity: 'critical' },
  { id: 'private-key', desc: 'Private key (PEM)', re: /-----BEGIN[A-Z ]*PRIVATE KEY-----/g, severity: 'critical' },
  { id: 'jwt', desc: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: 'high' },
  { id: 'slack-webhook', desc: 'Slack webhook URL', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{20,}/g, severity: 'high' },
  { id: 'discord-webhook', desc: 'Discord webhook URL', re: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d{17,}\/[A-Za-z0-9_-]{60,}/g, severity: 'high' },
  {
    id: 'generic-secret', desc: 'Hardcoded secret or credential',
    re: /\b(?:secret|password|passwd|pwd|api[-_]?key|apikey|auth[-_]?token|access[-_]?token|bearer)\b["']?\s*[=:]\s*["'][^"'\s]{16,}["']/gi,
    severity: 'critical',
  },
];

const PLACEHOLDER_RE = /example|your[-_ ]|<your|\{your|\$\{|\$\(|insert_|placeholder|dummy|redacted|xxxx|\*\*\*\*|changeme|fake|sample|<[a-z_ -]+>|\.\.\.|test/i;

function looksLikePlaceholder(line: string, match: string): boolean {
  if (/(.)\1{7,}/.test(match)) return true; // aaaaaaaa / 00000000
  return PLACEHOLDER_RE.test(line) || /^(sk|ghp|xox)[-_]?x+$/i.test(match);
}

function maskOne(match: string): string {
  return `${match.slice(0, 4)}${'•'.repeat(8)}`;
}

function mask(line: string, match: string): string {
  return clip(line.replace(match, maskOne(match)), 160);
}

/** Masks anything that looks like a credential, so no finding snippet can echo a secret back into the UI. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (m) => (rule.id === 'private-key' ? m : maskOne(m)));
  }
  return out;
}

export function validateSecrets(pkg: SkillPackage, c: Collector): void {
  const C = 'SECRETS';
  const files = scannableFiles(pkg);
  const seen = new Set<string>();
  let found = 0;
  for (const f of files) {
    const text = f.text!;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(text))) {
        const line = lineAt(text, m.index);
        const ltxt = lineText(text, line);
        if (rule.id !== 'private-key' && looksLikePlaceholder(ltxt, m[0])) continue;
        const key = `${f.path}:${line}`;
        if (seen.has(key)) continue; // one finding per line; the first (most specific) rule wins
        seen.add(key);
        found++;
        c.add(C, rule.id, rule.severity, `${rule.desc} found in ${f.path}:${line}`, {
          filePath: f.path, line, snippet: mask(ltxt, m[0]),
          suggestion: 'Remove it from the skill, rotate the credential (it is compromised once shared), and read it from an environment variable instead.',
        });
      }
    }
  }
  if (!found) c.pass(C, 'secrets', `No secrets detected in ${files.length} text file(s)`);
}
