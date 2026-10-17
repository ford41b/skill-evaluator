export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export type Tier = 1 | 2 | 3;

/** A file as dropped by the user, before skills are discovered. */
export interface RawFile {
  /** Path relative to the dropped root, forward slashes. */
  path: string;
  data: Uint8Array;
}

export interface SkillFile {
  /** Path relative to the skill root. */
  path: string;
  size: number;
  /** Decoded text, or null for binary / oversized files. */
  text: string | null;
  binary: boolean;
}

export interface SkillPackage {
  /** Unique within one evaluation (dirName can repeat across dropped folders). */
  id: string;
  /** Folder name of the skill root (or a fallback such as the zip name). */
  dirName: string;
  /** Skill root relative to the dropped root ("" when SKILL.md is at the top). */
  rootPath: string;
  files: SkillFile[];
}

export interface Finding {
  id: string;
  tier: Tier;
  category: string;
  checkName: string;
  severity: Severity;
  message: string;
  filePath?: string;
  line?: number;
  /** The offending source line(s), trimmed. */
  snippet?: string;
  suggestion?: string;
  /** Free-form extras for rendering (e.g. matched duplicate location). */
  data?: Record<string, unknown>;
}

export interface CheckPass {
  category: string;
  checkName: string;
  message: string;
}

export interface QualityIssue {
  severity: 'error' | 'warning' | 'info';
  dimension: DimensionName;
  message: string;
  suggestion?: string;
  deduction: number;
}

export type DimensionName = 'correctness' | 'discoverability' | 'reliability' | 'efficiency';

export interface QualityDimension {
  name: DimensionName;
  score: number;
  weight: number;
  issues: QualityIssue[];
}

export type SkillType = 'script-based' | 'lib-based' | 'resource-based' | 'guide-only' | 'hybrid';

export interface QualityScore {
  overall: number;
  grade: Grade;
  skillType: SkillType;
  dimensions: Record<DimensionName, QualityDimension>;
  totalTokens: number;
  frontmatterTokens: number;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export type TierStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface Tier1Result {
  findings: Finding[];
  passes: CheckPass[];
  quality: QualityScore | null;
  status: TierStatus;
}

export interface DuplicatePair {
  a: { path: string; startLine: number; endLine: number; text: string };
  b: { path: string; startLine: number; endLine: number; text: string };
  similarity: number;
}

export interface SkillOverlap {
  other: string;
  similarity: number;
  nameCollision: boolean;
}

export interface Tier2Result {
  findings: Finding[];
  passes: CheckPass[];
  duplicates: DuplicatePair[];
  overlaps: SkillOverlap[];
  chunksAnalyzed: number;
  interSkillRan: boolean;
  status: TierStatus;
}

export interface EvalCase {
  id: string;
  prompt: string;
  expected_output: string;
  assertions: string[];
  /** false marks a negative control: the skill should NOT be used. */
  should_trigger?: boolean;
}

export interface EvalDataset {
  skill_name: string;
  evals: EvalCase[];
}

export type TriggerVerdict = 'likely' | 'maybe' | 'unlikely';

export interface TriggerResult {
  prompt: string;
  score: number;
  verdict: TriggerVerdict;
  matchedTerms: string[];
  /** Name of a competing skill that scores within range of this one, if any. */
  competitor?: { name: string; score: number };
}

export interface ReadinessBreakdown {
  dataset: number;
  caseCount: number;
  assertions: number;
  scriptCoverage: number;
  triggers: number;
}

export interface Tier3Result {
  findings: Finding[];
  passes: CheckPass[];
  datasetPath: string | null;
  datasetFormat: 'agentskills' | 'legacy' | null;
  caseCount: number;
  triggers: TriggerResult[];
  generatedDataset: EvalDataset | null;
  readiness: number;
  breakdown: ReadinessBreakdown;
  grade: Grade;
  status: TierStatus;
}

export interface SkillReport {
  name: string;
  dirName: string;
  files: SkillFile[];
  tier1: Tier1Result;
  tier2: Tier2Result;
  tier3: Tier3Result;
  /** Tier 1 and Tier 2 gate; Tier 3 is advisory (mirrors NVIDIA defaults). */
  passed: boolean;
  tokenCount: number;
}

export interface EvaluationReport {
  generatedAt: string;
  toolVersion: string;
  skills: SkillReport[];
}

export type Progress = { stage: string; done: number; total: number };

export const GRADE_THRESHOLDS: [number, Grade][] = [
  [90, 'A'],
  [80, 'B'],
  [70, 'C'],
  [60, 'D'],
  [0, 'F'],
];

export function scoreToGrade(score: number): Grade {
  for (const [t, g] of GRADE_THRESHOLDS) if (score >= t) return g;
  return 'F';
}
