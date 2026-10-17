import type { CheckPass, Finding, Severity, Tier } from '../types';
import { nextId } from '../util';
import { redactSecrets } from './secrets';

export interface FindingExtra {
  filePath?: string;
  line?: number;
  snippet?: string;
  suggestion?: string;
  data?: Record<string, unknown>;
}

/** Collects findings and passed checks for one tier. */
export class Collector {
  findings: Finding[] = [];
  passes: CheckPass[] = [];
  constructor(private tier: Tier) {}

  add(category: string, checkName: string, severity: Severity, message: string, extra: FindingExtra = {}): void {
    const snippet = extra.snippet === undefined ? undefined : redactSecrets(extra.snippet);
    this.findings.push({ id: nextId(`t${this.tier}`), tier: this.tier, category, checkName, severity, message, ...extra, snippet });
  }

  pass(category: string, checkName: string, message: string): void {
    this.passes.push({ category, checkName, message });
  }
}
