export interface Bookmark {
  id: number;
  sessionId: string;
  scrollOffset: number;
  label: string;
  timestamp: number;
}

let nextId = 1;

/** In-memory bookmark store, keyed by session id */
const bookmarksBySession = new Map<string, Bookmark[]>();

export function addBookmark(
  sessionId: string,
  scrollOffset: number,
  label?: string
): Bookmark {
  const bookmarks = bookmarksBySession.get(sessionId) ?? [];
  const bookmark: Bookmark = {
    id: nextId++,
    sessionId,
    scrollOffset,
    label: label ?? `Bookmark ${bookmarks.length + 1}`,
    timestamp: Date.now(),
  };
  bookmarks.push(bookmark);
  bookmarksBySession.set(sessionId, bookmarks);
  return bookmark;
}

export function getBookmarks(sessionId: string): Bookmark[] {
  return bookmarksBySession.get(sessionId) ?? [];
}

export function removeBookmark(sessionId: string, bookmarkId: number): void {
  const bookmarks = bookmarksBySession.get(sessionId) ?? [];
  bookmarksBySession.set(
    sessionId,
    bookmarks.filter((b) => b.id !== bookmarkId)
  );
}

export function clearBookmarks(sessionId: string): void {
  bookmarksBySession.delete(sessionId);
}
