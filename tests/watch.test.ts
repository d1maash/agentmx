import { describe, expect, it } from "vitest";
import {
  splitOutputForPrefix,
  summarizeChangedPaths,
} from "../src/cli/commands/watch.js";
import {
  parseAgentList,
  resolveRunTargets,
} from "../src/cli/commands/run-targets.js";
import { shouldIgnoreWatchPath } from "../src/core/workspace-watcher.js";

describe("parseAgentList", () => {
  it("trims whitespace and drops empty entries", () => {
    expect(parseAgentList(" codex, , claude-code ,")).toEqual([
      "codex",
      "claude-code",
    ]);
  });
});

describe("resolveRunTargets", () => {
  const config = {
    default_agent: "claude-code",
    agents: {},
    router: {
      mode: "rules" as const,
      rules: [{ match: "test|spec", agent: "codex" }],
    },
    ui: {
      theme: "dark" as const,
      show_tokens: false,
      show_cost: false,
      split_view: "vertical" as const,
    },
  };

  it("routes auto mode through the configured router", async () => {
    await expect(
      resolveRunTargets("write auth tests", { agent: "auto" }, config, [
        "codex",
        "claude-code",
      ])
    ).resolves.toEqual({
      initialAgent: "codex",
      splitView: false,
    });
  });

  it("returns parallel targets when parallel mode is used", async () => {
    await expect(
      resolveRunTargets("compare", { parallel: "codex,claude-code" }, config, [
        "codex",
        "claude-code",
      ])
    ).resolves.toEqual({
      parallelAgents: ["codex", "claude-code"],
      splitView: true,
    });
  });
});

describe("summarizeChangedPaths", () => {
  it("compresses long change lists", () => {
    expect(
      summarizeChangedPaths([
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
      ])
    ).toBe("src/a.ts, src/b.ts, src/c.ts +1 more");
  });
});

describe("splitOutputForPrefix", () => {
  it("keeps incomplete lines buffered between chunks", () => {
    expect(splitOutputForPrefix("", "first line\nsecond")).toEqual({
      flushed: ["first line"],
      pending: "second",
    });

    expect(splitOutputForPrefix("second", " line\nthird\n")).toEqual({
      flushed: ["second line", "third"],
      pending: "",
    });
  });
});

describe("shouldIgnoreWatchPath", () => {
  it("ignores noisy dependency and build folders", () => {
    expect(shouldIgnoreWatchPath("node_modules/react/index.js")).toBe(true);
    expect(shouldIgnoreWatchPath(".git/index")).toBe(true);
    expect(shouldIgnoreWatchPath("dist/index.js")).toBe(true);
  });

  it("still watches normal project files", () => {
    expect(shouldIgnoreWatchPath("src/index.ts")).toBe(false);
    expect(shouldIgnoreWatchPath(".agentmx.yml")).toBe(false);
  });
});
