import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await exec("git", args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    if (e.code === "ENOENT") throw new Error('"git" not found in PATH.');
    const stderr = (e.stderr ?? "").toString().trim();
    throw new Error(stderr || e.message || `git ${args[0]} failed`);
  }
}

export async function isGitRepo(cwd?: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(cwd?: string): Promise<string> {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

export async function hasUncommittedChanges(cwd?: string): Promise<boolean> {
  const status = await git(["status", "--porcelain"], cwd);
  return status.length > 0;
}

export async function createBranch(
  name: string,
  base: string,
  cwd?: string
): Promise<void> {
  await git(["checkout", "-b", name, base], cwd);
}

export async function checkoutBranch(name: string, cwd?: string): Promise<void> {
  await git(["checkout", name], cwd);
}

export async function commitAll(
  message: string,
  cwd?: string
): Promise<{ committed: boolean; sha?: string }> {
  await git(["add", "-A"], cwd);
  // Bail out if nothing is staged — `git commit` would error
  const staged = await git(["diff", "--cached", "--name-only"], cwd);
  if (!staged) return { committed: false };
  await git(["commit", "-m", message], cwd);
  const sha = await git(["rev-parse", "HEAD"], cwd);
  return { committed: true, sha };
}

export async function pushBranch(
  branch: string,
  cwd?: string,
  remote = "origin"
): Promise<void> {
  await git(["push", "-u", remote, branch], cwd);
}

export async function diffStat(cwd?: string, base = "HEAD~1"): Promise<string> {
  try {
    return await git(["diff", "--stat", base, "HEAD"], cwd);
  } catch {
    return "";
  }
}

export async function changedFiles(
  cwd?: string,
  base = "HEAD~1"
): Promise<string[]> {
  try {
    const out = await git(["diff", "--name-only", base, "HEAD"], cwd);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Build a default branch name from an issue. Sanitised to satisfy
 * git ref naming rules: only [a-z0-9-/], no consecutive dashes, length-capped.
 */
export function branchNameForIssue(
  issueNumber: number,
  title: string,
  prefix = "agentmx"
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const base = slug ? `${prefix}/issue-${issueNumber}-${slug}` : `${prefix}/issue-${issueNumber}`;
  return base.replace(/--+/g, "-");
}
