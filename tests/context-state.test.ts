import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRepoMap,
  createSharedContextState,
  formatSharedContextState,
  updateSharedContextState,
} from "../src/core/context-state.js";

describe("shared context state", () => {
  it("builds a compact repo map without dependency folders", () => {
    const root = mkdtempSync(join(tmpdir(), "agentmx-context-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "src", "index.ts"), "export {};");
    writeFileSync(join(root, "node_modules", "ignored.ts"), "ignored");

    const repoMap = buildRepoMap(root, 10);

    expect(repoMap.directories).toContain("src");
    expect(repoMap.directories).not.toContain("node_modules");
    expect(repoMap.files).toContain("package.json");
    expect(repoMap.files).toContain("src/index.ts");
  });

  it("extracts working-memory categories from agent output", () => {
    const state = createSharedContextState({
      cwd: process.cwd(),
      task: "fix flaky test",
      now: 1,
    });

    const changed = updateSharedContextState(state, {
      sourceAgent: "codex",
      sourceSessionId: "s1",
      timestamp: 2,
      text: [
        "Found src/core/context-bus.ts and tests/context-state.test.ts",
        "Hypothesis: the bus mirrors transcript chunks instead of state",
        "vitest failing test tests/context-state.test.ts expected state",
        "Decision: use a structured shared state object",
        "Rejected approach: raw transcript forwarding does not work",
        "Final patch candidate: update ContextBus broadcast format",
      ].join("\n"),
    });

    expect(changed).toBe(true);
    expect(state.foundFiles.map((item) => item.text)).toEqual([
      "src/core/context-bus.ts",
      "tests/context-state.test.ts",
    ]);
    expect(state.hypotheses[0].text).toContain("Hypothesis");
    expect(state.failingTests[0].text).toContain("vitest failing test");
    expect(state.decisions[0].text).toContain("Decision");
    expect(state.rejectedApproaches[0].text).toContain("Rejected approach");
    expect(state.finalPatchCandidates[0].text).toContain(
      "Final patch candidate"
    );
  });

  it("formats a structured snapshot instead of raw transcript", () => {
    const state = createSharedContextState({
      cwd: process.cwd(),
      task: "debug",
      now: 1,
    });

    updateSharedContextState(state, {
      sourceAgent: "codex",
      sourceSessionId: "s1",
      timestamp: 2,
      text: "Decision: patch src/core/context-bus.ts",
    });

    const snapshot = formatSharedContextState(state);

    expect(snapshot).toContain("[shared context state v1]");
    expect(snapshot).toContain("Repo root:");
    expect(snapshot).toContain("Found files:");
    expect(snapshot).toContain("Decisions:");
    expect(snapshot).not.toContain("[context from codex]");
  });
});
