import {
  promises as fsPromises,
  watch,
  type Dirent,
  type FSWatcher,
} from "node:fs";
import { join, relative, resolve } from "node:path";

const DEFAULT_IGNORED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
]);

const DEFAULT_IGNORED_BASENAMES = new Set([".DS_Store"]);

export interface WorkspaceWatcher {
  close(): Promise<void>;
}

export function shouldIgnoreWatchPath(relativePath: string): boolean {
  if (!relativePath || relativePath === ".") {
    return false;
  }

  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length === 0) {
    return false;
  }

  for (const segment of segments) {
    if (DEFAULT_IGNORED_SEGMENTS.has(segment)) {
      return true;
    }
  }

  return DEFAULT_IGNORED_BASENAMES.has(segments[segments.length - 1]);
}

export async function watchWorkspace(
  rootDir: string,
  onChange: (path: string) => void
): Promise<WorkspaceWatcher> {
  const root = resolve(rootDir);
  const watchers = new Map<string, FSWatcher>();
  let closed = false;
  let syncing = false;
  let pendingSync = false;

  const closeWatcher = (dir: string) => {
    const watcher = watchers.get(dir);
    if (!watcher) return;
    watcher.close();
    watchers.delete(dir);
  };

  const syncWatchers = async (): Promise<void> => {
    if (closed) return;
    if (syncing) {
      pendingSync = true;
      return;
    }

    syncing = true;
    try {
      const dirs = await collectWatchDirs(root, root);
      if (closed) return;

      const nextDirs = new Set(dirs);
      nextDirs.add(root);

      for (const dir of nextDirs) {
        if (watchers.has(dir)) continue;

        try {
          const watcher = watch(dir, (eventType, filename) => {
            if (closed) return;

            const changedPath = filename
              ? resolve(dir, filename.toString())
              : dir;
            const relativePath = relative(root, changedPath);
            if (relativePath && shouldIgnoreWatchPath(relativePath)) {
              return;
            }

            onChange(changedPath);

            if (eventType === "rename" || !filename) {
              void syncWatchers();
            }
          });

          watcher.on("error", () => {
            void syncWatchers();
          });

          watchers.set(dir, watcher);
        } catch {
          // Skip directories that disappear between scan and watch registration.
        }
      }

      for (const dir of Array.from(watchers.keys())) {
        if (!nextDirs.has(dir)) {
          closeWatcher(dir);
        }
      }
    } finally {
      syncing = false;
      if (pendingSync && !closed) {
        pendingSync = false;
        void syncWatchers();
      }
    }
  };

  await syncWatchers();

  return {
    async close() {
      closed = true;
      for (const dir of Array.from(watchers.keys())) {
        closeWatcher(dir);
      }
    },
  };
}

async function collectWatchDirs(
  root: string,
  currentDir: string
): Promise<string[]> {
  const dirs: string[] = [];

  let entries: Dirent<string>[];
  try {
    entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
  } catch {
    return dirs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = join(currentDir, entry.name);
    const relativePath = relative(root, fullPath);
    if (shouldIgnoreWatchPath(relativePath)) {
      continue;
    }

    dirs.push(fullPath);
    dirs.push(...(await collectWatchDirs(root, fullPath)));
  }

  return dirs;
}
