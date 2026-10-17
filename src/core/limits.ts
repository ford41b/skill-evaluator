/** Resource ceilings: skill content is untrusted input and everything runs in a browser tab. */
export const MAX_FILES = 3000;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
export const MAX_ZIP_ENTRY_BYTES = 32 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 5000;
export const MAX_DEDUP_CHUNKS = 512;
export const MAX_SKILLS = 200;

/** Directories skipped at any depth when reading dropped files at all. */
export const IGNORED_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', '__MACOSX', '.idea', '.vscode']);
export const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

/** Directories skipped by Tier 1 content scans (generated artifacts / snapshots). */
export const SCAN_EXCLUDED_DIRS = new Set([
  'evals', '.evals', 'results', '.results', 'versions', '.versions', '__pycache__', '.git', '.venv', 'node_modules',
]);
export const SCAN_EXCLUDED_FILES = new Set(['skill-card.md', 'BENCHMARK.md', 'skill.oms.sig']);

export const ALLOWED_SKILL_DIRS = new Set(['agents', 'references', 'scripts', 'assets', 'evals', 'tests', 'tools', 'config']);
export const EXECUTABLE_SKILL_DIRS = ['scripts', 'tools'];
export const QUALITY_RESOURCE_DIRS = ['assets', 'templates', 'design-system', 'resources'];
export const QUALITY_EXCLUDED_DIRS = new Set([
  'scripts', 'tools', 'references', 'assets', 'eval', 'evals', '.evals', 'results', '.results', 'versions', '.versions',
  'tests', 'examples', 'docs', 'resources', 'templates', 'design-system', '__pycache__', '.git', '.venv', 'node_modules',
]);

export const RESERVED_NAMES = ['anthropic', 'claude'];
export const FORBIDDEN_FIELDS = ['alwaysApply', 'always_apply', 'globs'];
export const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
export const COMPATIBILITY_MAX = 500;
export const MAX_SKILL_MD_LINES = 500;
export const RECOMMENDED_MAX_TOKENS = 5000;

export const SCANNABLE_TEXT_EXT = new Set([
  '.py', '.sh', '.bash', '.yaml', '.yml', '.json', '.md', '.mdc', '.txt', '.js', '.ts', '.mjs', '.cjs', '.toml', '.cfg', '.ini', '.env', '.html', '.css', '.csv', '.rb', '.go', '.rs', '.java',
]);

export const QUALITY_WEIGHTS = { correctness: 0.35, discoverability: 0.25, reliability: 0.25, efficiency: 0.15 } as const;

export const DEDUP_THRESHOLD = 0.8;
export const DEDUP_MIN_CHUNK_CHARS = 80;
export const DEDUP_TRIVIAL_MAX_CHARS = 400;
export const SIMILARITY_HIGH = 0.9;
export const SIMILARITY_MEDIUM = 0.75;
