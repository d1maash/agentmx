import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const exec = promisify(execFile);

async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") throw new Error('"git" not found in PATH.');
    throw new Error(((e.stderr ?? "").toString().trim()) || e.message || `git ${args[0]} failed`);
  }
}

export interface AllocateOptions {
  /** Logical label for this worktree — sanitised into the branch + dir name. */
  label: string;
  /** Where the worktree lives. Default: <repoRoot>/.agentmx/worktrees */
  baseDir?: string;
  /** Base ref. Default: HEAD of the calling repo. */
  baseRef?: string;
  /** When true, leave worktree on disk after cleanup() — only prune the registration. */
  keepOnCleanup?: boolean;
}

export interface AllocatedWorktree {
  /** Absolute path to the worktree's working directory — pass this as cwd to agents. */
  path: string;
  /** Branch name git created for this worktree. */
  branch: string;
  /** Remove the worktree and prune its registration. Idempotent. */
  cleanup: () => Promise<void>;
}

/** True when `cwd` is inside a git repository (works inside worktrees too). */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Absolute path to the repository's top-level (works inside worktrees too). */
export async function repoRoot(cwd: string): Promise<string> {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

function sanitiseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "agent";
}

function randomSuffix(): string {
  return randomBytes(3).toString("hex");
}

/**
 * Allocate an isolated git worktree off a new branch so an agent can
 * scribble freely without racing siblings. Caller must invoke
 * {@link AllocatedWorktree.cleanup} when done (or rely on the
 * batch cleanup helpers below).
 */
export async function allocateWorktree(
  cwd: string,
  opts: AllocateOptions
): Promise<AllocatedWorktree> {
  if (!(await isGitRepo(cwd))) {
    throw new Error(
      `worktree isolation requires a git repository (cwd=${cwd}). Initialise one with "git init" or pass --no-isolate.`
    );
  }

  const root = await repoRoot(cwd);
  const baseDir = opts.baseDir
    ? resolve(opts.baseDir)
    : join(root, ".agentmx", "worktrees");
  mkdirSync(baseDir, { recursive: true });

  const label = sanitiseLabel(opts.label);
  const suffix = randomSuffix();
  const dirName = `${label}-${suffix}`;
  const wtPath = join(baseDir, dirName);
  const branch = `agentmx/wt/${label}-${suffix}`;
  const baseRef = opts.baseRef ?? "HEAD";

  // -b <branch>: create branch off baseRef inside the new worktree.
  await git(["worktree", "add", "-b", branch, wtPath, baseRef], root);

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    if (opts.keepOnCleanup) {
      // Best-effort prune of dangling worktree registrations only.
      await git(["worktree", "prune"], root).catch(() => undefined);
      return;
    }
    // --force in case the agent left untracked junk; ignore failures so a
    // botched cleanup never crashes the caller.
    await git(["worktree", "remove", "--force", wtPath], root).catch(() => undefined);
    // Drop the throwaway branch too. Detached safety: -D not -d.
    await git(["branch", "-D", branch], root).catch(() => undefined);
    await git(["worktree", "prune"], root).catch(() => undefined);
  };

  return { path: wtPath, branch, cleanup };
}

/**
 * Allocate N worktrees, all rooted at the same baseRef. On any failure during
 * allocation, every successfully-created worktree is rolled back before the
 * error propagates — so callers never see a partial allocation.
 */
export async function allocateBatch(
  cwd: string,
  labels: string[],
  opts?: Omit<AllocateOptions, "label">
): Promise<AllocatedWorktree[]> {
  const allocated: AllocatedWorktree[] = [];
  try {
    for (const label of labels) {
      allocated.push(await allocateWorktree(cwd, { ...opts, label }));
    }
    return allocated;
  } catch (err) {
    await Promise.allSettled(allocated.map((w) => w.cleanup()));
    throw err;
  }
}

/**
 * Copy the patch produced inside a worktree back onto the caller's tree.
 * Used after vote/race/optimize to promote the winner. Returns true when a
 * non-empty patch was applied. Uncommitted changes in the worktree are
 * included via git diff against the baseRef so we don't require the agent to
 * have committed.
 */
export async function applyWorktreeDiff(
  worktreePath: string,
  destCwd: string,
  baseRef = "HEAD"
): Promise<boolean> {
  const diff = await git(["diff", baseRef], worktreePath).catch(() => "");
  if (!diff) return false;
  await new Promise<void>((resolveP, rejectP) => {
    const child = execFile(
      "git",
      ["apply", "--whitespace=nowarn", "-"],
      { cwd: destCwd, maxBuffer: 64 * 1024 * 1024 },
      (err) => (err ? rejectP(err) : resolveP())
    );
    child.stdin?.write(diff);
    child.stdin?.end();
  });
  return true;
}

/** Best-effort cleanup of every registered AgentMX worktree (orphans from crashes). */
export async function pruneOrphans(cwd: string): Promise<number> {
  if (!(await isGitRepo(cwd))) return 0;
  const root = await repoRoot(cwd);
  const list = await git(["worktree", "list", "--porcelain"], root).catch(() => "");
  let removed = 0;
  for (const block of list.split(/\n\n+/)) {
    const m = block.match(/^worktree\s+(.+)$/m);
    const b = block.match(/^branch\s+refs\/heads\/(.+)$/m);
    if (!m || !b) continue;
    if (!b[1].startsWith("agentmx/wt/")) continue;
    await git(["worktree", "remove", "--force", m[1]], root).catch(() => undefined);
    await git(["branch", "-D", b[1]], root).catch(() => undefined);
    removed += 1;
  }
  await git(["worktree", "prune"], root).catch(() => undefined);
  return removed;
}
