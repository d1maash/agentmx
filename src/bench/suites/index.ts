import type { BenchSuite } from "../types.js";
import { algorithmsSuite } from "./algorithms.js";
import { practicalSuite } from "./practical.js";

const suites = new Map<string, BenchSuite>([
  [algorithmsSuite.id, algorithmsSuite],
  [practicalSuite.id, practicalSuite],
]);

export function getSuite(id: string): BenchSuite | undefined {
  return suites.get(id);
}

export function getAllSuites(): BenchSuite[] {
  return Array.from(suites.values());
}

export function listSuiteIds(): string[] {
  return Array.from(suites.keys());
}
