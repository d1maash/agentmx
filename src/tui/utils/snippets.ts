import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Snippet {
  name: string;
  prompt: string;
  createdAt: number;
}

const SNIPPETS_DIR = join(homedir(), ".agentmx");
const SNIPPETS_FILE = join(SNIPPETS_DIR, "snippets.json");

export function loadSnippets(): Snippet[] {
  try {
    if (!existsSync(SNIPPETS_FILE)) return [];
    const raw = readFileSync(SNIPPETS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Snippet[];
  } catch {
    return [];
  }
}

export function saveSnippet(name: string, prompt: string): Snippet {
  const snippets = loadSnippets();
  const snippet: Snippet = { name, prompt, createdAt: Date.now() };
  // Replace if name exists, otherwise append
  const idx = snippets.findIndex((s) => s.name === name);
  if (idx >= 0) {
    snippets[idx] = snippet;
  } else {
    snippets.push(snippet);
  }
  writeSnippets(snippets);
  return snippet;
}

export function deleteSnippet(name: string): void {
  const snippets = loadSnippets().filter((s) => s.name !== name);
  writeSnippets(snippets);
}

function writeSnippets(snippets: Snippet[]): void {
  mkdirSync(SNIPPETS_DIR, { recursive: true });
  writeFileSync(SNIPPETS_FILE, JSON.stringify(snippets, null, 2), "utf-8");
}
