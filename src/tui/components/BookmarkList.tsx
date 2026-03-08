import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { type Bookmark, getBookmarks, removeBookmark } from "../utils/bookmarks.js";

interface BookmarkListProps {
  sessionId: string;
  onJump: (scrollOffset: number) => void;
  onClose: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

export function BookmarkList({ sessionId, onJump, onClose }: BookmarkListProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => getBookmarks(sessionId));
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(bookmarks.length - 1, i + 1));
      return;
    }

    if (key.return && bookmarks.length > 0) {
      onJump(bookmarks[selectedIndex].scrollOffset);
      onClose();
      return;
    }

    // 'd' to delete bookmark
    if (input === "d" && !key.ctrl && !key.meta && bookmarks.length > 0) {
      const bm = bookmarks[selectedIndex];
      removeBookmark(sessionId, bm.id);
      const updated = bookmarks.filter((b) => b.id !== bm.id);
      setBookmarks(updated);
      setSelectedIndex((i) => Math.min(i, Math.max(0, updated.length - 1)));
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
      <Text bold color="blue">Bookmarks</Text>
      {bookmarks.length === 0 ? (
        <Text dimColor>No bookmarks. Press Ctrl+B to add one at current position.</Text>
      ) : (
        bookmarks.map((bm, i) => (
          <Box key={bm.id}>
            <Text inverse={i === selectedIndex}>
              {i === selectedIndex ? " > " : "   "}
              <Text bold>{bm.label}</Text>
              <Text dimColor> at offset {bm.scrollOffset} — {formatTime(bm.timestamp)}</Text>
            </Text>
          </Box>
        ))
      )}
      <Text dimColor>↑/↓ select | Enter jump | d delete | Esc close</Text>
    </Box>
  );
}
