import { describe, expect, it } from "vitest";
import { parseIssueRef, parseChecks, waitForChecks } from "../src/core/github.js";
import { branchNameForIssue } from "../src/core/git-helpers.js";
import {
  PromptBuilder,
  buildPRBody,
  summariseChecks,
  formatReviewComment,
} from "../src/core/pr-factory.js";

describe("parseIssueRef", () => {
  it("accepts a bare number", () => {
    expect(parseIssueRef("42")).toBe(42);
  });

  it("accepts a hash-prefixed number", () => {
    expect(parseIssueRef("#123")).toBe(123);
  });

  it("accepts a full GitHub issue URL", () => {
    expect(
      parseIssueRef("https://github.com/owner/repo/issues/9000")
    ).toBe(9000);
  });

  it("ignores trailing fragments and query strings", () => {
    expect(
      parseIssueRef("https://github.com/owner/repo/issues/77#issuecomment-1")
    ).toBe(77);
  });

  it("rejects nonsense", () => {
    expect(() => parseIssueRef("not-a-number")).toThrow();
  });
});

describe("branchNameForIssue", () => {
  it("slugifies the title and prefixes by issue", () => {
    expect(
      branchNameForIssue(123, "Fix the broken login flow!!!")
    ).toBe("agentmx/issue-123-fix-the-broken-login-flow");
  });

  it("truncates long titles", () => {
    const branch = branchNameForIssue(
      1,
      "A really really really really really really really long title"
    );
    expect(branch.startsWith("agentmx/issue-1-")).toBe(true);
    // slug part is capped at 40 chars
    expect(branch.length).toBeLessThan(70);
  });

  it("falls back when title has no usable characters", () => {
    expect(branchNameForIssue(7, "!!!")).toBe("agentmx/issue-7");
  });
});

describe("parseChecks", () => {
  it("classifies passed, failed and pending runs", () => {
    const snap = parseChecks([
      { name: "lint", status: "completed", conclusion: "success" },
      { name: "test", status: "completed", conclusion: "failure" },
      { name: "deploy", status: "in_progress", conclusion: "" },
    ]);
    expect(snap.passed.map((r) => r.name)).toEqual(["lint"]);
    expect(snap.failed.map((r) => r.name)).toEqual(["test"]);
    expect(snap.pending.map((r) => r.name)).toEqual(["deploy"]);
    expect(snap.allDone).toBe(false);
    expect(snap.anyFailed).toBe(true);
  });

  it("treats timed_out as failed", () => {
    const snap = parseChecks([
      { name: "e2e", status: "completed", conclusion: "timed_out" },
    ]);
    expect(snap.anyFailed).toBe(true);
  });

  it("returns allDone when every run is completed", () => {
    const snap = parseChecks([
      { name: "lint", status: "completed", conclusion: "success" },
      { name: "test", status: "completed", conclusion: "success" },
    ]);
    expect(snap.allDone).toBe(true);
    expect(snap.anyFailed).toBe(false);
  });

  it("handles empty input", () => {
    const snap = parseChecks([]);
    expect(snap.allDone).toBe(false);
    expect(snap.anyFailed).toBe(false);
  });
});

describe("waitForChecks", () => {
  it("returns the first snapshot where all checks are done", async () => {
    let calls = 0;
    const snapshots = [
      {
        pending: [{ name: "test", status: "in_progress", conclusion: "" as const }],
        failed: [],
        passed: [],
        allDone: false,
        anyFailed: false,
      },
      {
        pending: [],
        failed: [],
        passed: [{ name: "test", status: "completed", conclusion: "success" as const }],
        allDone: true,
        anyFailed: false,
      },
    ];

    const result = await waitForChecks(123, {
      timeoutMs: 60_000,
      pollIntervalMs: 1,
      now: () => 0,
      sleep: () => Promise.resolve(),
      fetchChecks: async () => snapshots[Math.min(calls++, snapshots.length - 1)],
    });

    expect(result.allDone).toBe(true);
    expect(calls).toBe(2);
  });

  it("returns the last snapshot when the timeout is hit", async () => {
    let t = 0;
    const result = await waitForChecks(7, {
      timeoutMs: 5,
      pollIntervalMs: 10,
      now: () => t,
      sleep: async () => {
        t += 10;
      },
      fetchChecks: async () => ({
        pending: [{ name: "test", status: "queued", conclusion: "" as const }],
        failed: [],
        passed: [],
        allDone: false,
        anyFailed: false,
      }),
    });

    expect(result.allDone).toBe(false);
    expect(result.pending).toHaveLength(1);
  });
});

describe("PromptBuilder", () => {
  const issue = {
    number: 42,
    title: "Login button is broken",
    body: "When I click login nothing happens.",
    state: "OPEN",
    labels: ["bug"],
    url: "https://github.com/owner/repo/issues/42",
    author: "alice",
  };

  it("coder prompt includes issue body and number", () => {
    const prompt = PromptBuilder.coder({ issue });
    expect(prompt).toContain("ISSUE #42");
    expect(prompt).toContain("Login button is broken");
    expect(prompt).toContain("When I click login nothing happens.");
  });

  it("reviewer prompt embeds the diff and demands a verdict line", () => {
    const prompt = PromptBuilder.reviewer({
      issue,
      diff: "src/login.ts | 3 +-",
      coderOutput: "Wired up the click handler.",
    });
    expect(prompt).toContain("src/login.ts | 3 +-");
    expect(prompt).toContain("VERDICT: PASS");
  });

  it("ci-fix prompt lists the failing checks", () => {
    const prompt = PromptBuilder.ciFix({
      issue,
      failingChecks: {
        pending: [],
        passed: [],
        failed: [
          {
            name: "test",
            status: "completed",
            conclusion: "failure",
            link: "https://example.com/run/1",
          },
        ],
        allDone: true,
        anyFailed: true,
      },
    });
    expect(prompt).toContain("- test (https://example.com/run/1)");
  });
});

describe("buildPRBody", () => {
  it("references the issue, diff, files and roles", () => {
    const body = buildPRBody({
      issue: {
        number: 9,
        title: "Add foo",
        body: "",
        state: "OPEN",
        labels: [],
        url: "https://github.com/o/r/issues/9",
        author: "bob",
      },
      coderOutput: "Implemented foo.",
      diff: "src/foo.ts | 5 ++",
      files: ["src/foo.ts"],
      roles: { coder: "claude-code", reviewer: "codex", tester: "gemini" },
    });
    expect(body).toContain("[#9](https://github.com/o/r/issues/9)");
    expect(body).toContain("`src/foo.ts`");
    expect(body).toContain("src/foo.ts | 5 ++");
    expect(body).toContain("coder=`claude-code`");
    expect(body).toContain("reviewer=`codex`");
    expect(body).toContain("tester=`gemini`");
    expect(body).toContain("Closes #9");
  });
});

describe("summariseChecks", () => {
  it("describes the mixed state with names of failures", () => {
    expect(
      summariseChecks({
        pending: [{ name: "deploy", status: "queued", conclusion: "" }],
        failed: [{ name: "test", status: "completed", conclusion: "failure" }],
        passed: [{ name: "lint", status: "completed", conclusion: "success" }],
        allDone: false,
        anyFailed: true,
      })
    ).toBe("1 passed, 1 failed, 1 pending — failing: test");
  });

  it("handles the no-checks case", () => {
    expect(
      summariseChecks({
        pending: [],
        failed: [],
        passed: [],
        allDone: false,
        anyFailed: false,
      })
    ).toBe("No CI checks reported.");
  });
});

describe("formatReviewComment", () => {
  it("prefixes with the agentmx header", () => {
    const out = formatReviewComment("codex", "Looks good!");
    expect(out.startsWith("🤖 **agentmx code review**")).toBe(true);
    expect(out).toContain("`codex`");
    expect(out).toContain("Looks good!");
  });
});
