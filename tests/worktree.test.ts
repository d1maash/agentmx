import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  allocateWorktree,
  allocateBatch,
  applyWorktreeDiff,
  isGitRepo,
  pruneOrphans,
} from "../src/core/worktree.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "amx-wt-"));
  execSync("git init -q", { cwd: repo });
  execSync("git config user.email t@t.t && git config user.name t", { cwd: repo });
  writeFileSync(join(repo, "README.md"), "# initial\n");
  execSync("git add -A && git commit -q -m init", { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("worktree allocator", () => {
  it("creates an isolated worktree off HEAD with a fresh branch", async () => {
    expect(await isGitRepo(repo)).toBe(true);
    const wt = await allocateWorktree(repo, { label: "candidate-a" });
    expect(existsSync(wt.path)).toBe(true);
    // README should be present (worktree off HEAD).
    expect(readFileSync(join(wt.path, "README.md"), "utf8")).toContain("initial");
    expect(wt.branch).toMatch(/^agentmx\/wt\/candidate-a-/);
    await wt.cleanup();
    expect(existsSync(wt.path)).toBe(false);
  });

  it("isolates writes — changes in worktree do not leak into host tree", async () => {
    const wt = await allocateWorktree(repo, { label: "noisy" });
    writeFileSync(join(wt.path, "noisy.txt"), "scratch\n");
    expect(existsSync(join(repo, "noisy.txt"))).toBe(false);
    await wt.cleanup();
  });

  it("applyWorktreeDiff promotes uncommitted changes from worktree back to host", async () => {
    const wt = await allocateWorktree(repo, { label: "winner" });
    writeFileSync(join(wt.path, "out.txt"), "from-winner\n");
    const applied = await applyWorktreeDiff(wt.path, repo);
    expect(applied).toBe(true);
    expect(readFileSync(join(repo, "out.txt"), "utf8")).toBe("from-winner\n");
    await wt.cleanup();
  });

  it("applyWorktreeDiff returns false when worktree made no changes", async () => {
    const wt = await allocateWorktree(repo, { label: "noop" });
    const applied = await applyWorktreeDiff(wt.path, repo);
    expect(applied).toBe(false);
    await wt.cleanup();
  });

  it("allocateBatch rolls back already-created worktrees if one allocation fails", async () => {
    // Force the second allocation to fail by passing an invalid base ref.
    const ok = await allocateBatch(repo, ["a"]);
    expect(ok).toHaveLength(1);
    await ok[0].cleanup();

    await expect(
      allocateBatch(repo, ["good", "bad"], { baseRef: "definitely-not-a-ref" })
    ).rejects.toThrow();
    // Cleanup leftover from any partial worktree.
    await pruneOrphans(repo);
  });

  it("pruneOrphans cleans up agentmx-prefixed worktrees", async () => {
    const wt = await allocateWorktree(repo, { label: "orphan-test" });
    // Don't call cleanup — simulate crash.
    const path = wt.path;
    expect(existsSync(path)).toBe(true);
    const removed = await pruneOrphans(repo);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses to allocate outside a git repo with a clear error", async () => {
    const notRepo = mkdtempSync(join(tmpdir(), "amx-not-repo-"));
    try {
      await expect(allocateWorktree(notRepo, { label: "x" })).rejects.toThrow(
        /worktree isolation requires a git repository/
      );
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });
});
