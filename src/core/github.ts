import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url: string;
  author: string;
}

export interface GitHubPR {
  number: number;
  url: string;
  headRefName: string;
}

export type CheckConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "neutral"
  | "timed_out"
  | "action_required"
  | "stale"
  | "";

export interface CheckRun {
  name: string;
  status: string;
  conclusion: CheckConclusion;
  workflow?: string;
  link?: string;
}

export interface ChecksSnapshot {
  pending: CheckRun[];
  failed: CheckRun[];
  passed: CheckRun[];
  allDone: boolean;
  anyFailed: boolean;
}

const GH_NOT_FOUND =
  'GitHub CLI ("gh") not found. Install it from https://cli.github.com/ and run "gh auth login".';

async function gh(args: string[], opts: { cwd?: string } = {}): Promise<string> {
  try {
    const { stdout } = await exec("gh", args, {
      cwd: opts.cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    if (e.code === "ENOENT") throw new Error(GH_NOT_FOUND);
    const stderr = (e.stderr ?? "").toString().trim();
    throw new Error(stderr || e.message || `gh ${args[0]} failed`);
  }
}

export async function checkGhInstalled(): Promise<boolean> {
  try {
    await exec("gh", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse an issue reference into a number.
 * Accepts: "123", "#123", "https://github.com/owner/repo/issues/123".
 */
export function parseIssueRef(ref: string): number {
  const trimmed = ref.trim();
  const urlMatch = trimmed.match(/\/issues\/(\d+)(?:[#?].*)?$/);
  if (urlMatch) return Number(urlMatch[1]);
  const numMatch = trimmed.match(/^#?(\d+)$/);
  if (numMatch) return Number(numMatch[1]);
  throw new Error(
    `Could not parse issue reference "${ref}". Use a number, "#123", or a GitHub issue URL.`
  );
}

export async function getIssue(
  ref: string | number,
  cwd?: string
): Promise<GitHubIssue> {
  const number = typeof ref === "number" ? ref : parseIssueRef(ref);
  const stdout = await gh(
    [
      "issue",
      "view",
      String(number),
      "--json",
      "number,title,body,state,labels,url,author",
    ],
    { cwd }
  );
  const raw = JSON.parse(stdout) as {
    number: number;
    title: string;
    body: string | null;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
    author: { login: string };
  };
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state,
    labels: raw.labels.map((l) => l.name),
    url: raw.url,
    author: raw.author.login,
  };
}

export async function createPR(
  args: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  },
  cwd?: string
): Promise<GitHubPR> {
  const argv = [
    "pr",
    "create",
    "--title",
    args.title,
    "--body",
    args.body,
    "--head",
    args.head,
    "--base",
    args.base,
  ];
  if (args.draft) argv.push("--draft");
  const stdout = await gh(argv, { cwd });
  const url = stdout.trim().split("\n").pop()?.trim() ?? "";
  const numMatch = url.match(/\/pull\/(\d+)$/);
  if (!numMatch) throw new Error(`Could not parse PR URL: ${url}`);
  return {
    number: Number(numMatch[1]),
    url,
    headRefName: args.head,
  };
}

export async function addPRComment(
  prNumber: number,
  body: string,
  cwd?: string
): Promise<void> {
  await gh(["pr", "comment", String(prNumber), "--body", body], { cwd });
}

/**
 * Parse the `gh pr checks --json` payload into a snapshot.
 * Exported so it can be unit-tested without invoking gh.
 */
export function parseChecks(raw: unknown): ChecksSnapshot {
  const arr = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  const runs: CheckRun[] = arr.map((c) => ({
    name: String(c.name ?? c.workflow ?? "check"),
    status: String(c.status ?? "").toLowerCase(),
    conclusion: String(c.conclusion ?? "").toLowerCase() as CheckConclusion,
    workflow: c.workflow ? String(c.workflow) : undefined,
    link: c.link ? String(c.link) : undefined,
  }));

  const pending = runs.filter(
    (r) => r.status !== "completed" || r.conclusion === ""
  );
  const failed = runs.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out"
  );
  const passed = runs.filter((r) => r.conclusion === "success");

  return {
    pending,
    failed,
    passed,
    allDone: runs.length > 0 && pending.length === 0,
    anyFailed: failed.length > 0,
  };
}

export async function getPRChecks(
  prNumber: number,
  cwd?: string
): Promise<ChecksSnapshot> {
  // gh pr checks may exit non-zero when checks are failing — capture stdout anyway
  try {
    const stdout = await gh(
      ["pr", "checks", String(prNumber), "--json", "name,status,conclusion,workflow,link"],
      { cwd }
    );
    return parseChecks(JSON.parse(stdout));
  } catch (err) {
    const e = err as { stdout?: string; message: string };
    // gh exits 1 when any check failed but still prints JSON
    if (e.stdout) {
      try {
        return parseChecks(JSON.parse(e.stdout));
      } catch {
        /* fall through */
      }
    }
    // No checks configured yet — treat as "not done" so caller can short-circuit
    if (/no checks/i.test(e.message)) {
      return { pending: [], failed: [], passed: [], allDone: false, anyFailed: false };
    }
    throw err;
  }
}

export interface WaitForChecksOptions {
  /** Total time budget in milliseconds. Default 15 minutes. */
  timeoutMs?: number;
  /** Polling interval in milliseconds. Default 20s. */
  pollIntervalMs?: number;
  /** Called on each poll with the latest snapshot. */
  onPoll?: (snapshot: ChecksSnapshot) => void;
  /** Override clock for tests. */
  now?: () => number;
  /** Override sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Override fetch for tests. */
  fetchChecks?: (prNumber: number) => Promise<ChecksSnapshot>;
}

export async function waitForChecks(
  prNumber: number,
  opts: WaitForChecksOptions = {},
  cwd?: string
): Promise<ChecksSnapshot> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const pollIntervalMs = opts.pollIntervalMs ?? 20_000;
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchChecks =
    opts.fetchChecks ?? ((n: number) => getPRChecks(n, cwd));

  const deadline = now() + timeoutMs;
  let last: ChecksSnapshot = {
    pending: [],
    failed: [],
    passed: [],
    allDone: false,
    anyFailed: false,
  };

  while (now() < deadline) {
    last = await fetchChecks(prNumber);
    opts.onPoll?.(last);
    if (last.allDone) return last;
    await sleep(pollIntervalMs);
  }
  return last;
}
