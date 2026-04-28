import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import stripAnsi from "strip-ansi";

export type SharedContextCategory =
  | "foundFiles"
  | "hypotheses"
  | "failingTests"
  | "decisions"
  | "rejectedApproaches"
  | "finalPatchCandidates";

export interface RepoMap {
  root: string;
  directories: string[];
  files: string[];
  truncated: boolean;
  updatedAt: number;
}

export interface SharedContextItem {
  id: string;
  text: string;
  sourceAgent: string;
  sourceSessionId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  hits: number;
}

export interface SharedContextState {
  version: 1;
  task?: string;
  repoMap: RepoMap;
  foundFiles: SharedContextItem[];
  hypotheses: SharedContextItem[];
  failingTests: SharedContextItem[];
  decisions: SharedContextItem[];
  rejectedApproaches: SharedContextItem[];
  finalPatchCandidates: SharedContextItem[];
  updatedAt: number;
}

export interface SharedContextUpdate {
  sourceAgent: string;
  sourceSessionId: string;
  text: string;
  timestamp?: number;
}

const IGNORE_DIRS = new Set([
  ".git",
  ".turbo",
  ".next",
  ".cache",
  "coverage",
  "dist",
  "build",
  "node_modules",
]);

const IMPORTANT_FILE_NAMES = new Set([
  "README.md",
  "AGENTS.md",
  "package.json",
  "tsconfig.json",
  "vitest.config.ts",
  "vite.config.ts",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".css",
  ".scss",
  ".html",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sh",
  ".sql",
  ".toml",
]);

const PATH_RE =
  /(?:^|[\s("'`])((?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+(?:\.[\w.-]+)?(?::\d+)?|[\w@.-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|css|scss|html|py|rs|go|java|c|cpp|h|hpp|sh|sql|toml)(?::\d+)?)/gi;

export function createSharedContextState(options?: {
  cwd?: string;
  task?: string;
  now?: number;
}): SharedContextState {
  const now = options?.now ?? Date.now();

  return {
    version: 1,
    task: options?.task,
    repoMap: buildRepoMap(options?.cwd ?? process.cwd(), now),
    foundFiles: [],
    hypotheses: [],
    failingTests: [],
    decisions: [],
    rejectedApproaches: [],
    finalPatchCandidates: [],
    updatedAt: now,
  };
}

export function updateSharedContextState(
  state: SharedContextState,
  update: SharedContextUpdate
): boolean {
  const timestamp = update.timestamp ?? Date.now();
  const lines = normalizeText(update.text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isSharedStateEcho(line));

  let changed = false;

  for (const line of lines) {
    for (const file of extractPaths(line)) {
      changed =
        upsertItem(state.foundFiles, file, update, timestamp) || changed;
    }

    for (const category of classifyLine(line)) {
      changed =
        upsertItem(state[category], line, update, timestamp) || changed;
    }
  }

  if (changed) {
    state.updatedAt = timestamp;
  }

  return changed;
}

export function formatSharedContextState(
  state: SharedContextState,
  options?: { maxItemsPerCategory?: number }
): string {
  const maxItems = options?.maxItemsPerCategory ?? 6;
  const lines = [
    "[shared context state v1]",
    state.task ? `Task: ${state.task}` : undefined,
    `Repo root: ${state.repoMap.root}`,
    formatList("Repo dirs", state.repoMap.directories, 8),
    formatList("Repo files", state.repoMap.files, 12),
    state.repoMap.truncated ? "Repo map: truncated" : undefined,
    formatItems("Found files", state.foundFiles, maxItems),
    formatItems("Hypotheses", state.hypotheses, maxItems),
    formatItems("Failing tests", state.failingTests, maxItems),
    formatItems("Decisions", state.decisions, maxItems),
    formatItems("Rejected approaches", state.rejectedApproaches, maxItems),
    formatItems(
      "Final patch candidates",
      state.finalPatchCandidates,
      maxItems
    ),
    "[/shared context state]",
  ].filter((line): line is string => Boolean(line));

  return `\n${lines.join("\n")}\n`;
}

export function buildRepoMap(root: string, now = Date.now()): RepoMap {
  const directories: string[] = [];
  const files: string[] = [];
  let truncated = false;
  const maxEntries = 120;
  const maxDepth = 3;

  const walk = (dir: string, depth: number) => {
    if (directories.length + files.length >= maxEntries) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (directories.length + files.length >= maxEntries) {
        truncated = true;
        return;
      }

      if (entry.name.startsWith(".") && entry.name !== ".agentmx.yml") {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relPath = relative(root, fullPath);

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        directories.push(relPath);
        if (depth < maxDepth) {
          walk(fullPath, depth + 1);
        }
        continue;
      }

      if (entry.isFile() && shouldIncludeRepoFile(fullPath, entry.name)) {
        files.push(relPath);
      }
    }
  };

  walk(root, 0);

  return {
    root,
    directories,
    files,
    truncated,
    updatedAt: now,
  };
}

function upsertItem(
  items: SharedContextItem[],
  text: string,
  update: SharedContextUpdate,
  timestamp: number
): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const id = stableId(normalized);
  const existing = items.find((item) => item.id === id);
  if (existing) {
    existing.lastSeenAt = timestamp;
    existing.hits += 1;
    return true;
  }

  items.push({
    id,
    text: normalized,
    sourceAgent: update.sourceAgent,
    sourceSessionId: update.sourceSessionId,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    hits: 1,
  });

  if (items.length > 30) {
    items.splice(0, items.length - 30);
  }

  return true;
}

function classifyLine(line: string): SharedContextCategory[] {
  const categories: SharedContextCategory[] = [];

  if (isFailingTest(line)) categories.push("failingTests");
  if (isHypothesis(line)) categories.push("hypotheses");
  if (isDecision(line)) categories.push("decisions");
  if (isRejectedApproach(line)) categories.push("rejectedApproaches");
  if (isPatchCandidate(line)) categories.push("finalPatchCandidates");

  return categories;
}

function isFailingTest(line: string): boolean {
  return (
    /\b(fail(?:ed|ing)?|error|assertionerror|expected|received|not ok|exception)\b/i.test(
      line
    ) &&
    /\b(test|spec|vitest|jest|pytest|assert|suite|ci|build|typecheck|lint|pnpm|npm)\b/i.test(
      line
    )
  );
}

function isHypothesis(line: string): boolean {
  return /\b(hypothes(?:is|ize)|suspect|likely|probably|maybe|might|could be|root cause|looks like|i think)\b|похоже|возможно|вероятно|гипотез/i.test(
    line
  );
}

function isDecision(line: string): boolean {
  return /\b(decision|decided|choose|chosen|going to|will use|we should|i'll|i will)\b|решени|решил|буду|выбира/i.test(
    line
  );
}

function isRejectedApproach(line: string): boolean {
  return /\b(reject(?:ed)?|avoid|not viable|dead end|doesn'?t work|didn'?t work|won'?t|skip this)\b|не подходит|отклон|не сработ/i.test(
    line
  );
}

function isPatchCandidate(line: string): boolean {
  return /\b(patch candidate|final patch|candidate fix|fix is|change is|implement(?:ed|ing)?|update(?:d)?|edit(?:ed)?)\b|патч|фикс|реализ|измен/i.test(
    line
  );
}

function extractPaths(line: string): string[] {
  const paths = new Set<string>();
  for (const match of line.matchAll(PATH_RE)) {
    const path = match[1].replace(/^["'`(]+|["'`),.;]+$/g, "");
    if (path.length > 1 && !path.includes("://")) {
      paths.add(path);
    }
  }
  return Array.from(paths);
}

function normalizeText(text: string): string {
  return stripAnsi(text).replace(/\r/g, "\n");
}

function isSharedStateEcho(line: string): boolean {
  return (
    line.startsWith("[shared context state") ||
    line.startsWith("[/shared context state]") ||
    line.startsWith("Repo root:") ||
    line.startsWith("Repo dirs:") ||
    line.startsWith("Repo files:")
  );
}

function shouldIncludeRepoFile(path: string, name: string): boolean {
  if (IMPORTANT_FILE_NAMES.has(name)) return true;
  if (name.endsWith(".lock")) return false;

  try {
    if (statSync(path).size > 512 * 1024) return false;
  } catch {
    return false;
  }

  const dotIndex = name.lastIndexOf(".");
  const ext = dotIndex >= 0 ? name.slice(dotIndex) : "";
  return CODE_EXTENSIONS.has(ext);
}

function stableId(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function formatList(title: string, values: string[], max: number): string {
  if (values.length === 0) return `${title}: none`;

  const visible = values.slice(0, max).join(", ");
  const extra = values.length > max ? ` +${values.length - max} more` : "";
  return `${title}: ${visible}${extra}`;
}

function formatItems(
  title: string,
  items: SharedContextItem[],
  max: number
): string {
  if (items.length === 0) return `${title}: none`;

  const visible = items
    .slice(-max)
    .map((item) => `- ${item.text} (${item.sourceAgent})`)
    .join("\n");

  return `${title}:\n${visible}`;
}
