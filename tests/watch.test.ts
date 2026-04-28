import { describe, expect, it } from "vitest";
import type { SavedSession } from "../src/core/session-store.js";
import { Router } from "../src/core/router.js";
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
    const targets = await resolveRunTargets(
      "write auth tests",
      { agent: "auto" },
      config,
      ["codex", "claude-code"]
    );

    expect(targets).toMatchObject({
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

describe("Router history mode", () => {
  const config = {
    default_agent: "claude-code",
    agents: {
      "claude-code": { command: "claude", args: [], env: {}, enabled: true },
      codex: { command: "codex", args: [], env: {}, enabled: true },
      gemini: { command: "gemini", args: [], env: {}, enabled: true },
    },
    router: {
      mode: "auto" as const,
      rules: [],
    },
    ui: {
      theme: "dark" as const,
      show_tokens: false,
      show_cost: false,
      split_view: "vertical" as const,
    },
  };

  function session(
    agentName: string,
    task: string,
    status: "done" | "error",
    cost?: number
  ): SavedSession {
    return {
      id: `${agentName}-${task}-${status}`,
      agentName,
      task,
      startedAt: 1,
      endedAt: 2,
      exitCode: status === "done" ? 0 : 1,
      status,
      cwd: "/repo",
      buffer:
        cost === undefined
          ? [{ type: "stdout", data: "ok", timestamp: 1 }]
          : [
              {
                type: "system",
                data: "cost",
                timestamp: 1,
                activity: { kind: "cost", totalCost: cost, durationMs: 1 },
              },
            ],
    };
  }

  it("uses task history to pick a review loop for risky auth fixes", async () => {
    const router = new Router(config, {
      sessions: [
        session("claude-code", "fix auth bug", "done", 0.2),
        session("claude-code", "fix login token issue", "done", 0.2),
        session("codex", "fix auth bug", "error", 0.05),
        session("codex", "write ui component", "done", 0.05),
        session("gemini", "fix build error", "done", 0.01),
      ],
    });

    await expect(
      router.routePlan("fix auth bug", ["claude-code", "codex", "gemini"])
    ).resolves.toMatchObject({
      strategy: "review-loop",
      taskKind: "security",
      primaryAgent: "claude-code",
      roles: {
        coder: "claude-code",
      },
    });
  });

  it("can choose cheap-first when a cheaper agent is reliable enough", async () => {
    const router = new Router(config, {
      sessions: [
        session("claude-code", "update docs", "done", 0.4),
        session("claude-code", "write docs", "done", 0.4),
        session("codex", "update docs", "done", 0.02),
        session("codex", "write docs", "done", 0.02),
        session("gemini", "update docs", "error", 0.01),
      ],
    });

    await expect(
      router.routePlan("cheap update docs", ["claude-code", "codex", "gemini"])
    ).resolves.toMatchObject({
      strategy: "cheap-first",
      taskKind: "docs",
      primaryAgent: "codex",
      fallbackAgent: "claude-code",
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
