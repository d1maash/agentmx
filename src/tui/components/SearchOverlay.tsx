import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

interface SearchOverlayProps {
  /** All searchable text lines from current agent output */
  lines: string[];
  onClose: () => void;
  /** Navigate to a specific line offset in the output */
  onJumpToOffset: (offset: number) => void;
}

export function SearchOverlay({ lines, onClose, onJumpToOffset }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [currentMatch, setCurrentMatch] = useState(0);

  // Update matches when query changes
  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      setCurrentMatch(0);
      return;
    }
    const q = query.toLowerCase();
    const found: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        found.push(i);
      }
    }
    setMatches(found);
    setCurrentMatch(0);
    // Jump to first match
    if (found.length > 0) {
      const lineIndex = found[0];
      const offset = Math.max(0, lines.length - lineIndex - 1);
      onJumpToOffset(offset);
    }
  }, [query, lines.length]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return) {
      // Next match
      if (matches.length > 0) {
        const next = (currentMatch + 1) % matches.length;
        setCurrentMatch(next);
        const lineIndex = matches[next];
        const offset = Math.max(0, lines.length - lineIndex - 1);
        onJumpToOffset(offset);
      }
      return;
    }

    // Shift+Tab or up arrow for previous match
    if (key.upArrow) {
      if (matches.length > 0) {
        const prev = (currentMatch - 1 + matches.length) % matches.length;
        setCurrentMatch(prev);
        const lineIndex = matches[prev];
        const offset = Math.max(0, lines.length - lineIndex - 1);
        onJumpToOffset(offset);
      }
      return;
    }

    if (key.downArrow) {
      if (matches.length > 0) {
        const next = (currentMatch + 1) % matches.length;
        setCurrentMatch(next);
        const lineIndex = matches[next];
        const offset = Math.max(0, lines.length - lineIndex - 1);
        onJumpToOffset(offset);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      return;
    }

    // Ignore control/meta keys
    if (key.ctrl || key.meta || key.tab) return;

    if (input && input.length === 1 && input.charCodeAt(0) >= 0x20) {
      setQuery((prev) => prev + input);
    }
  });

  const columns = process.stdout.columns ?? 120;

  return (
    <Box
      borderStyle="single"
      borderColor="yellow"
      width={Math.min(columns, 80)}
      paddingX={1}
      flexDirection="column"
    >
      <Box>
        <Text color="yellow" bold>Search: </Text>
        <Text>{query}</Text>
        <Text color="yellow">█</Text>
        <Box flexGrow={1} />
        {matches.length > 0 ? (
          <Text dimColor>
            {currentMatch + 1}/{matches.length} matches
          </Text>
        ) : query.trim() ? (
          <Text color="red" dimColor>No matches</Text>
        ) : null}
      </Box>
      <Text dimColor>Enter/↓ next | ↑ prev | Esc close</Text>
    </Box>
  );
}
