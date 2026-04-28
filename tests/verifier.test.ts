import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureDiff,
  computeOverallScore,
  formatProof,
  verifySolution,
  type CheckResult,
} from "../src/core/verifier.js";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "amx-verify-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email t@t.t", { cwd: dir });
  execSync("git config user.name t", { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  execSync("git add .", { cwd: dir });
  execSync("git commit -q -m init", { cwd: dir });
  return dir;
}

describe("computeOverallScore", () => {
  it("ignores skipped and zero-weight checks", () => {
    const checks: CheckResult[] = [
      { name: "a", status: "pass", score: 100, summary: "", weight: 4 },
      { name: "b", status: "fail", score: 0, summary: "", weight: 2 },
      { name: "c", status: "skip", score: null, summary: "", weight: 0 },
      { name: "d", status: "pass", score: 80, summary: "", weight: 0 },
    ];
    // (100*4 + 0*2) / 6 = 66.66 → 67
    expect(computeOverallScore(checks)).toBe(67);
  });

  it("returns 0 when no checks contribute weight", () => {
    expect(
      computeOverallScore([
        { name: "x", status: "skip", score: null, summary: "", weight: 0 },
      ])
    ).toBe(0);
  });
});

describe("captureDiff", () => {
  let dir: string;
  beforeEach(() => {
    dir = initRepo();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty stats when there are no changes", () => {
    const { patch, stats } = captureDiff(dir);
    expect(patch).toBe("");
    expect(stats.filesChanged).toBe(0);
    expect(stats.insertions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  it("captures modified tracked files", () => {
    writeFileSync(join(dir, "README.md"), "hello\nworld\n");
    const { patch, stats } = captureDiff(dir);
    expect(patch).toContain("+world");
    expect(stats.filesChanged).toBe(1);
    expect(stats.insertions).toBe(1);
    expect(stats.files).toEqual(["README.md"]);
  });

  it("captures untracked files", () => {
    writeFileSync(join(dir, "new.txt"), "fresh\n");
    const { patch, stats } = captureDiff(dir);
    expect(patch).toContain("fresh");
    expect(stats.files).toContain("new.txt");
  });
});

describe("verifySolution", () => {
  let dir: string;
  beforeEach(() => {
    dir = initRepo();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails verdict when there is no patch", () => {
    const proof = verifySolution({
      cwd: dir,
      task: "do something",
      runTests: false,
      runLint: false,
      runTypecheck: false,
    });
    expect(proof.verdict).toBe("fail");
    const diff = proof.checks.find((c) => c.name === "diff")!;
    expect(diff.status).toBe("fail");
    expect(diff.weight).toBeGreaterThan(0);
  });

  it("passes the diff check when files have changed", () => {
    writeFileSync(join(dir, "README.md"), "hello\nupdated\n");
    const proof = verifySolution({
      cwd: dir,
      task: "tweak README.md",
      runTests: false,
      runLint: false,
      runTypecheck: false,
    });
    const diff = proof.checks.find((c) => c.name === "diff")!;
    expect(diff.status).toBe("pass");
    const compliance = proof.checks.find((c) => c.name === "compliance")!;
    expect(compliance.status).toBe("pass");
    expect(proof.verdict).toBe("pass");
  });

  it("flags compliance failure when patch ignores file hint", () => {
    writeFileSync(join(dir, "unrelated.txt"), "x\n");
    const proof = verifySolution({
      cwd: dir,
      task: "edit src/foo.ts to do thing",
      runTests: false,
      runLint: false,
      runTypecheck: false,
    });
    const compliance = proof.checks.find((c) => c.name === "compliance")!;
    expect(compliance.status).toBe("fail");
    expect(compliance.summary).toContain("does not touch");
  });
});

describe("formatProof", () => {
  it("renders verdict, score, and per-check summary", () => {
    const out = formatProof({
      verdict: "pass",
      overallScore: 90,
      patch: "",
      diffStats: {
        filesChanged: 1,
        insertions: 2,
        deletions: 0,
        files: ["a.ts"],
      },
      checks: [
        {
          name: "tests",
          status: "pass",
          score: 100,
          summary: "vitest: ok",
          weight: 4,
        },
      ],
      taskSummary: "do thing",
      durationMs: 42,
    });
    expect(out).toContain("PASS");
    expect(out).toContain("90/100");
    expect(out).toContain("tests");
    expect(out).toContain("vitest: ok");
  });
});
