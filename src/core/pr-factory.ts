import type { AgentAdapter, AgentOutput } from "../adapters/types.js";
import type { ProcessManager } from "./process-manager.js";
import {
  type GitHubIssue,
  type GitHubPR,
  type ChecksSnapshot,
  getIssue,
  createPR,
  addPRComment,
  waitForChecks,
} from "./github.js";
import {
  branchNameForIssue,
  changedFiles,
  checkoutBranch,
  commitAll,
  createBranch,
  currentBranch,
  diffStat,
  hasUncommittedChanges,
  isGitRepo,
  pushBranch,
} from "./git-helpers.js";

export type PRFactoryStage =
  | "fetch-issue"
  | "code"
  | "test"
  | "commit-push"
  | "open-pr"
  | "review"
  | "ci-watch"
  | "ci-fix";

export interface PRFactoryRoles {
  coder: string;
  reviewer: string;
  /** Optional — if omitted, the test stage is skipped. */
  tester?: string;
}

export interface PRFactoryOptions {
  base: string;
  cwd: string;
  /** Branch name override. Default: derived from the issue title. */
  branch?: string;
  /** Open the PR as draft. */
  draft?: boolean;
  /** Watch CI and run a follow-up coder pass on failure. */
  watchCi?: boolean;
  /** Maximum CI fix rounds. Default 1. */
  maxCiRounds?: number;
  /** CI poll timeout in ms. Default 15min. */
  ciTimeoutMs?: number;
  /** CI poll interval in ms. Default 20s. */
  ciPollMs?: number;
  /** Override issue fetcher (for tests). */
  fetchIssue?: (ref: string | number) => Promise<GitHubIssue>;
}

export interface PRFactoryStageResult {
  stage: PRFactoryStage;
  agent?: string;
  output: string;
  exitCode: number;
  durationMs: number;
}

export interface PRFactoryEvent {
  stage: PRFactoryStage;
  agent?: string;
  /** Streaming chunk from an agent. */
  output?: AgentOutput;
  /** Stage completed. */
  stageComplete?: boolean;
  stageResult?: PRFactoryStageResult;
  /** Free-form status text from a non-agent stage (e.g. git, gh). */
  info?: string;
  /** Final summary fields, set on the very last event. */
  issue?: GitHubIssue;
  pr?: GitHubPR;
  checks?: ChecksSnapshot;
  allResults?: PRFactoryStageResult[];
}

export interface PromptContext {
  issue: GitHubIssue;
  coderOutput?: string;
  testerOutput?: string;
  diff?: string;
  failingChecks?: ChecksSnapshot;
  reviewOutput?: string;
}

/**
 * Builds prompts for each stage. Pure functions — exported for tests.
 */
export const PromptBuilder = {
  coder(ctx: PromptContext): string {
    const { issue } = ctx;
    return `You are implementing a GitHub issue. Read the repository, make the changes, and write the necessary code directly into the working directory.

ISSUE #${issue.number}: ${issue.title}

DESCRIPTION:
${issue.body || "(no description provided)"}

LABELS: ${issue.labels.join(", ") || "(none)"}

INSTRUCTIONS:
1. Investigate the codebase before editing.
2. Implement a focused, minimal change that resolves the issue.
3. Do not commit or push — another step will handle git.
4. After you are done, briefly summarise what you changed and why.
5. If a test stage runs after you, the next agent will add tests for your changes.`;
  },

  tester(ctx: PromptContext): string {
    return `You are adding tests for a change another agent just made. The code is already written in the working directory.

ORIGINAL ISSUE #${ctx.issue.number}: ${ctx.issue.title}

CODER NOTES:
${ctx.coderOutput?.slice(-4000) ?? "(unavailable)"}

INSTRUCTIONS:
1. Read the changed files (use git diff to find them).
2. Add tests that cover the new behavior, including edge cases.
3. Run the test suite to confirm everything passes.
4. Do not commit — another step will handle git.`;
  },

  reviewer(ctx: PromptContext): string {
    return `You are doing a code review of a pull request that was just opened to address a GitHub issue.

ISSUE #${ctx.issue.number}: ${ctx.issue.title}

DIFF SUMMARY (git diff --stat):
${ctx.diff ?? "(no diff available)"}

CODER NOTES:
${ctx.coderOutput?.slice(-3000) ?? "(unavailable)"}

INSTRUCTIONS:
1. Inspect the changed files in the working directory and reason about correctness.
2. Look for bugs, missing edge cases, security issues, and regressions.
3. Be specific — quote file paths and line numbers.
4. End with a single-line verdict: "VERDICT: PASS", "VERDICT: NEEDS_CHANGES", or "VERDICT: FAIL".

Your entire response will be posted as a PR review comment, so format it as Markdown.`;
  },

  ciFix(ctx: PromptContext): string {
    const failed = ctx.failingChecks?.failed ?? [];
    const list = failed
      .map((c) => `- ${c.name}${c.link ? ` (${c.link})` : ""}`)
      .join("\n");
    return `CI failed on the pull request you just opened. Investigate and fix the failing checks.

ISSUE #${ctx.issue.number}: ${ctx.issue.title}

FAILING CHECKS:
${list || "(none reported)"}

REVIEW FEEDBACK (if any):
${ctx.reviewOutput?.slice(-3000) ?? "(none)"}

INSTRUCTIONS:
1. Pull the failing logs locally if you can (e.g. via "gh run view --log-failed"), or reason from the test output already in the workspace.
2. Make the smallest fix that turns the build green.
3. Do not commit — the workflow will commit and push your changes.`;
  },
};

/**
 * Multi-agent pipeline that takes a GitHub issue, runs agents, opens a PR,
 * collects a review, and optionally fixes CI failures.
 */
export class PRFactory {
  /** Optional USD cap applied per agent stage. Killed agents fail their stage. */
  maxCostPerStageUsd?: number;

  constructor(
    private roles: PRFactoryRoles,
    private processManager: ProcessManager,
    private adapters: Map<string, AgentAdapter>
  ) {}

  async *execute(
    issueRef: string | number,
    opts: PRFactoryOptions
  ): AsyncGenerator<PRFactoryEvent> {
    for (const [role, name] of Object.entries(this.roles)) {
      if (name && !this.adapters.has(name)) {
        throw new Error(`Agent "${name}" for role "${role}" not found`);
      }
    }
    if (!(await isGitRepo(opts.cwd))) {
      throw new Error(
        `Not a git repository: ${opts.cwd}. PR Factory must run inside a git checkout.`
      );
    }
    if (await hasUncommittedChanges(opts.cwd)) {
      throw new Error(
        "Working tree has uncommitted changes. Commit, stash, or discard them before running pr-factory."
      );
    }

    const results: PRFactoryStageResult[] = [];

    // -------- Stage 1: fetch issue --------
    const fetchStart = Date.now();
    const fetchIssue = opts.fetchIssue ?? ((r) => getIssue(r, opts.cwd));
    yield { stage: "fetch-issue", info: `Fetching issue ${issueRef}…` };
    const issue = await fetchIssue(issueRef);
    yield {
      stage: "fetch-issue",
      info: `#${issue.number} ${issue.title} (by @${issue.author})`,
    };
    const fetchResult: PRFactoryStageResult = {
      stage: "fetch-issue",
      output: `${issue.url}\n${issue.title}`,
      exitCode: 0,
      durationMs: Date.now() - fetchStart,
    };
    results.push(fetchResult);
    yield { stage: "fetch-issue", stageComplete: true, stageResult: fetchResult };

    // -------- Branch setup --------
    const branchName = opts.branch ?? branchNameForIssue(issue.number, issue.title);
    const startingBranch = await currentBranch(opts.cwd);
    yield {
      stage: "code",
      info: `Creating branch "${branchName}" from "${opts.base}"…`,
    };
    await createBranch(branchName, opts.base, opts.cwd);

    // -------- Stage 2: coder --------
    const ctx: PromptContext = { issue };
    const coderResult = yield* this.runAgentStage(
      "code",
      this.roles.coder,
      PromptBuilder.coder(ctx)
    );
    results.push(coderResult);
    ctx.coderOutput = coderResult.output;

    // -------- Stage 3: tester (optional) --------
    if (this.roles.tester) {
      const testerResult = yield* this.runAgentStage(
        "test",
        this.roles.tester,
        PromptBuilder.tester(ctx)
      );
      results.push(testerResult);
      ctx.testerOutput = testerResult.output;
    }

    // -------- Stage 4: commit & push --------
    const commitStart = Date.now();
    yield { stage: "commit-push", info: "Committing changes…" };
    const commitMessage = buildCommitMessage(issue, this.roles);
    const { committed, sha } = await commitAll(commitMessage, opts.cwd);
    if (!committed) {
      // Roll back the branch — agents made no changes.
      await checkoutBranch(startingBranch, opts.cwd).catch(() => {});
      throw new Error(
        "Agents produced no file changes — nothing to commit. Aborting before opening a PR."
      );
    }
    ctx.diff = await diffStat(opts.cwd, opts.base);
    const files = await changedFiles(opts.cwd, opts.base);
    yield {
      stage: "commit-push",
      info: `Committed ${sha?.slice(0, 7)} (${files.length} file${files.length === 1 ? "" : "s"}). Pushing…`,
    };
    await pushBranch(branchName, opts.cwd);
    const pushResult: PRFactoryStageResult = {
      stage: "commit-push",
      output: `${sha ?? ""}\n${ctx.diff}`,
      exitCode: 0,
      durationMs: Date.now() - commitStart,
    };
    results.push(pushResult);
    yield { stage: "commit-push", stageComplete: true, stageResult: pushResult };

    // -------- Stage 5: open PR --------
    const prStart = Date.now();
    yield { stage: "open-pr", info: "Opening pull request…" };
    const body = buildPRBody({ issue, coderOutput: coderResult.output, diff: ctx.diff, files, roles: this.roles });
    const pr = await createPR(
      {
        title: prTitle(issue),
        body,
        head: branchName,
        base: opts.base,
        draft: opts.draft,
      },
      opts.cwd
    );
    const openResult: PRFactoryStageResult = {
      stage: "open-pr",
      output: pr.url,
      exitCode: 0,
      durationMs: Date.now() - prStart,
    };
    results.push(openResult);
    yield { stage: "open-pr", info: `PR #${pr.number} → ${pr.url}` };
    yield { stage: "open-pr", stageComplete: true, stageResult: openResult };

    // -------- Stage 6: reviewer --------
    const reviewerResult = yield* this.runAgentStage(
      "review",
      this.roles.reviewer,
      PromptBuilder.reviewer(ctx)
    );
    results.push(reviewerResult);
    ctx.reviewOutput = reviewerResult.output;

    yield { stage: "review", info: `Posting review comment to PR #${pr.number}…` };
    try {
      await addPRComment(
        pr.number,
        formatReviewComment(this.roles.reviewer, reviewerResult.output),
        opts.cwd
      );
    } catch (err) {
      yield {
        stage: "review",
        info: `Failed to post review comment: ${(err as Error).message}`,
      };
    }

    // -------- Stage 7: CI watch + optional fix loop --------
    let lastChecks: ChecksSnapshot | undefined;
    if (opts.watchCi !== false) {
      const maxRounds = opts.maxCiRounds ?? 1;
      let round = 0;

      while (round <= maxRounds) {
        yield {
          stage: "ci-watch",
          info:
            round === 0
              ? "Waiting for CI checks…"
              : `Waiting for CI after fix round ${round}…`,
        };
        lastChecks = await waitForChecks(
          pr.number,
          {
            timeoutMs: opts.ciTimeoutMs,
            pollIntervalMs: opts.ciPollMs,
            onPoll: (snap) => {
              // Surface a single-line heartbeat per poll
            },
          },
          opts.cwd
        );

        const watchResult: PRFactoryStageResult = {
          stage: "ci-watch",
          output: summariseChecks(lastChecks),
          exitCode: lastChecks.anyFailed ? 1 : 0,
          durationMs: 0,
        };
        results.push(watchResult);
        yield {
          stage: "ci-watch",
          info: summariseChecks(lastChecks),
          stageComplete: true,
          stageResult: watchResult,
        };

        if (!lastChecks.anyFailed || round === maxRounds) break;
        round++;

        ctx.failingChecks = lastChecks;
        const fixResult = yield* this.runAgentStage(
          "ci-fix",
          this.roles.coder,
          PromptBuilder.ciFix(ctx)
        );
        results.push(fixResult);

        const fixCommitStart = Date.now();
        yield { stage: "ci-fix", info: "Committing CI fix…" };
        const fix = await commitAll(
          `fix(ci): address failing checks for issue #${issue.number}\n\nRun ${round}`,
          opts.cwd
        );
        if (!fix.committed) {
          yield {
            stage: "ci-fix",
            info: "Agent produced no further changes — stopping fix loop.",
          };
          break;
        }
        await pushBranch(branchName, opts.cwd);
        try {
          await addPRComment(
            pr.number,
            `🤖 agentmx pushed a CI fix (round ${round}, commit \`${fix.sha?.slice(0, 7)}\`).`,
            opts.cwd
          );
        } catch {
          /* non-fatal */
        }
        const ciFixDone: PRFactoryStageResult = {
          stage: "ci-fix",
          agent: this.roles.coder,
          output: fix.sha ?? "",
          exitCode: 0,
          durationMs: Date.now() - fixCommitStart,
        };
        results.push(ciFixDone);
        yield { stage: "ci-fix", stageComplete: true, stageResult: ciFixDone };
      }
    }

    // -------- Final summary --------
    yield {
      stage: lastChecks ? "ci-watch" : "review",
      issue,
      pr,
      checks: lastChecks,
      allResults: results,
    };
  }

  private async *runAgentStage(
    stage: PRFactoryStage,
    agentName: string,
    prompt: string
  ): AsyncGenerator<PRFactoryEvent, PRFactoryStageResult> {
    const adapter = this.adapters.get(agentName)!;
    const start = Date.now();
    const sessionId = await this.processManager.start(adapter, prompt, {
      maxCostUsd: this.maxCostPerStageUsd,
    });
    const proc = this.processManager.get(sessionId);
    if (!proc) throw new Error(`Failed to start ${agentName} for ${stage} stage`);

    let output = "";
    for await (const chunk of proc.output) {
      output += chunk.data;
      yield { stage, agent: agentName, output: chunk };
    }
    const { exitCode } = await proc.done;

    const result: PRFactoryStageResult = {
      stage,
      agent: agentName,
      output: output.trim(),
      exitCode,
      durationMs: Date.now() - start,
    };
    yield { stage, agent: agentName, stageComplete: true, stageResult: result };
    return result;
  }
}

// ---------- helpers ----------

function prTitle(issue: GitHubIssue): string {
  // Truncate to GitHub's de-facto soft limit
  const max = 70;
  const base = `${issue.title} (closes #${issue.number})`;
  return base.length <= max ? base : `${issue.title.slice(0, max - 18)}… (closes #${issue.number})`;
}

function buildCommitMessage(
  issue: GitHubIssue,
  roles: PRFactoryRoles
): string {
  return `feat: ${issue.title}\n\nCloses #${issue.number}\n\nGenerated by agentmx pr-factory (coder=${roles.coder}${
    roles.tester ? `, tester=${roles.tester}` : ""
  }, reviewer=${roles.reviewer}).`;
}

export function buildPRBody(args: {
  issue: GitHubIssue;
  coderOutput: string;
  diff: string;
  files: string[];
  roles: PRFactoryRoles;
}): string {
  const { issue, coderOutput, diff, files, roles } = args;
  const fileList = files.length
    ? files.map((f) => `- \`${f}\``).join("\n")
    : "_(no files reported)_";
  const summary = coderOutput.slice(-2000).trim() || "_(no agent summary)_";

  return `## Summary

This PR was generated by **agentmx pr-factory** to address [#${issue.number}](${issue.url}) — ${issue.title}.

**Agents:** coder=\`${roles.coder}\`${roles.tester ? `, tester=\`${roles.tester}\`` : ""}, reviewer=\`${roles.reviewer}\`

## Changed files

${fileList}

## Diff stat

\`\`\`
${diff || "(no diff)"}
\`\`\`

## Coder report

${summary}

---

Closes #${issue.number}.

🤖 Generated with [agentmx](https://github.com/d1maash/agentmx)`;
}

export function summariseChecks(snap: ChecksSnapshot): string {
  const total = snap.passed.length + snap.failed.length + snap.pending.length;
  if (total === 0) return "No CI checks reported.";
  const parts: string[] = [];
  if (snap.passed.length) parts.push(`${snap.passed.length} passed`);
  if (snap.failed.length) parts.push(`${snap.failed.length} failed`);
  if (snap.pending.length) parts.push(`${snap.pending.length} pending`);
  const failed = snap.failed.map((f) => f.name).join(", ");
  return failed
    ? `${parts.join(", ")} — failing: ${failed}`
    : parts.join(", ");
}

export function formatReviewComment(reviewer: string, body: string): string {
  return `🤖 **agentmx code review** (reviewer: \`${reviewer}\`)\n\n${body.trim()}`;
}
