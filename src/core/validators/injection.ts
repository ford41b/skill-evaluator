import type { Severity, SkillPackage } from '../types';
import { clip, ext, isExcludedPath, lineAt, lineText } from '../util';
import type { Collector } from './ctx';

interface Pattern { id: string; re: RegExp; severity: Severity; message: string }

/**
 * Offline heuristics for prompt-injection and exfiltration instructions.
 * NVIDIA's tool uses an LLM and SkillSpector for this; these are pattern-based
 * approximations and can miss paraphrased attacks.
 */
const PATTERNS: Pattern[] = [
  { id: 'override-instructions', severity: 'high', message: 'Tries to override earlier instructions',
    re: /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)*(?:previous|prior|above|earlier|system|safety)\s+(?:instructions?|prompts?|rules|guidelines|policies)/gi },
  { id: 'jailbreak-persona', severity: 'high', message: 'Jailbreak-style persona switch',
    re: /\byou\s+are\s+now\s+(?:in\s+)?(?:dan|developer\s+mode|jailbroken|unrestricted|an?\s+unfiltered)/gi },
  { id: 'conceal-from-user', severity: 'high', message: 'Instructs the agent to hide actions from the user',
    re: /\b(?:do\s+not|don'?t|never)\s+(?:tell|inform|notify|alert|mention\s+(?:this\s+)?to|reveal\s+(?:this\s+)?to|let)\s+(?:the\s+)?user\b|\bwithout\s+(?:the\s+user\s+knowing|telling\s+the\s+user|user\s+(?:approval|confirmation|consent))\b/gi },
  { id: 'reveal-system-prompt', severity: 'medium', message: 'Asks the agent to reveal its system prompt or hidden instructions',
    re: /\b(?:reveal|print|output|show|leak|repeat)\s+(?:your|the)\s+(?:system\s+prompt|hidden\s+instructions|initial\s+instructions)/gi },
  { id: 'exfiltrate-secrets', severity: 'critical', message: 'Sends credentials or sensitive files to a remote location',
    re: /\b(?:send|post|upload|exfiltrate|curl|wget|transmit)\b[^\n]{0,100}(?:~\/\.ssh|id_rsa|\.aws\/credentials|\/etc\/passwd|\.env\b|\.npmrc|api[_ -]?keys?|credentials|passwords?)[^\n]{0,100}(?:https?:\/\/|\bto\b)/gi },
  { id: 'obfuscated-exec', severity: 'critical', message: 'Decodes and executes hidden payloads',
    re: /base64\s*(?:-d|--decode|decode)[^\n]{0,80}\|\s*(?:ba|z)?sh\b|\bFromBase64String\b[^\n]{0,80}\bIEX\b/gi },
  { id: 'read-sensitive-files', severity: 'medium', message: 'Reads credential or key files outside the skill',
    re: /\b(?:cat|read|open|copy|cp)\b[^\n]{0,40}(?:~\/\.ssh\/|\/\.aws\/credentials|\/etc\/shadow|\.config\/gcloud)/gi },
  { id: 'hidden-html-instructions', severity: 'medium', message: 'HTML comment contains instruction-like text (invisible when rendered)',
    re: /<!--[\s\S]{0,400}?(?:ignore|system prompt|you must|assistant|instruction)[\s\S]{0,400}?-->/gi },
];

export function validateInjection(pkg: SkillPackage, c: Collector): void {
  const C = 'INJECTION';
  const files = pkg.files.filter((f) => f.text !== null && !isExcludedPath(f.path) && ['.md', '.mdc', '.txt', '.yaml', '.yml', '.json'].includes(ext(f.path)));
  let found = 0;
  const seen = new Set<string>();
  for (const f of files) {
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(f.text!))) {
        const line = lineAt(f.text!, m.index);
        const key = `${p.id}:${f.path}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // A skill that *documents* attacks (e.g. a security-review skill) is common; keep it visible but softer inside quotes/fences handled by severity floor.
        found++;
        c.add(C, p.id, p.severity, `${p.message} (pattern-based check)`, {
          filePath: f.path, line, snippet: clip(lineText(f.text!, line) || m[0], 200),
          suggestion: 'If this is intentional (e.g. a skill about security testing), keep it clearly framed as an example. Otherwise remove it.',
        });
      }
    }
  }
  if (!found) c.pass(C, 'prompt_injection', 'No prompt-injection or exfiltration patterns found');
}
