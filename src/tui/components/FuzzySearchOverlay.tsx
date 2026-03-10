import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";

export interface FuzzySearchResult {
  sessionId: string;
  sessionName: string;
  lineIndex: number;
  line: string;
  score: number;
  /** Character positions in `line` that matched the query */
  matchPositions: number[];
}

interface FuzzySearchOverlayProps {
  /** All sessions with their searchable lines */
  sessions: {
    id: string;
    displayName: string;
    lines: string[];
  }[];
  onClose: () => void;
  /** Switch to a specific tab and jump to a scroll offset */
  onSelect: (sessionId: string, lineIndex: number, totalLines: number) => void;
}

/** Simple fuzzy match: characters must appear in order. Returns score + positions or null. */
function fuzzyMatch(query: string, target: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (q.length === 0) return null;
  if (q.length > t.length) return null;

  const positions: number[] = [];
  let qi = 0;
  let score = 0;
  let prevMatchIdx = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      positions.push(ti);

      // Consecutive match bonus
      if (ti === prevMatchIdx + 1) {
        score += 8;
      }

      // Start of word bonus (after space, _, -, /, .)
      if (ti === 0 || " _-/.".includes(t[ti - 1])) {
        score += 5;
      }

      // Exact case bonus
      if (target[ti] === query[qi]) {
        score += 1;
      }

      // Proximity bonus: penalize distance from previous match
      if (prevMatchIdx >= 0) {
        const gap = ti - prevMatchIdx - 1;
        score -= Math.min(gap, 5);
      }

      prevMatchIdx = ti;
      qi++;
    }
  }

  // All query chars must be found
  if (qi < q.length) return null;

  // Base score: prefer shorter targets
  score += Math.max(0, 50 - t.length);

  return { score, positions };
}

const MAX_VISIBLE_RESULTS = 15;

export function FuzzySearchOverlay({ sessions, onClose, onSelect }: FuzzySearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Build results from all sessions
  const results = useMemo<FuzzySearchResult[]>(() => {
    if (!query.trim()) return [];

    const allResults: FuzzySearchResult[] = [];

    for (const session of sessions) {
      for (let i = 0; i < session.lines.length; i++) {
        const line = session.lines[i];
        const match = fuzzyMatch(query, line);
        if (match) {
          allResults.push({
            sessionId: session.id,
            sessionName: session.displayName,
            lineIndex: i,
            line,
            score: match.score,
            matchPositions: match.positions,
          });
        }
      }
    }

    // Sort by score descending
    allResults.sort((a, b) => b.score - a.score);

    // Limit to top results for performance
    return allResults.slice(0, 200);
  }, [query, sessions]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, query]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.return) {
      const result = results[selectedIndex];
      if (result) {
        const session = sessions.find((s) => s.id === result.sessionId);
        if (session) {
          onSelect(result.sessionId, result.lineIndex, session.lines.length);
        }
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
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
  const rows = process.stdout.rows ?? 40;
  const boxWidth = Math.min(columns - 4, 100);
  const maxResults = Math.min(MAX_VISIBLE_RESULTS, rows - 8);

  // Viewport scroll for results list
  const viewStart = Math.max(0, Math.min(selectedIndex - Math.floor(maxResults / 2), results.length - maxResults));
  const visibleResults = results.slice(viewStart, viewStart + maxResults);

  return (
    <Box
      borderStyle="single"
      borderColor="magenta"
      width={boxWidth}
      flexDirection="column"
      paddingX={1}
    >
      {/* Header */}
      <Box>
        <Text color="magenta" bold>Fuzzy: </Text>
        <Text>{query}</Text>
        <Text color="magenta">█</Text>
        <Box flexGrow={1} />
        {results.length > 0 ? (
          <Text dimColor>
            {selectedIndex + 1}/{results.length}
            {results.length >= 200 ? "+" : ""}
          </Text>
        ) : query.trim() ? (
          <Text color="red" dimColor>No matches</Text>
        ) : (
          <Text dimColor>type to search all tabs</Text>
        )}
      </Box>

      {/* Results */}
      {visibleResults.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          {visibleResults.map((result, i) => {
            const globalIndex = viewStart + i;
            const isSelected = globalIndex === selectedIndex;
            const lineText = truncateLine(result.line, boxWidth - result.sessionName.length - 10);
            return (
              <Box key={`${result.sessionId}-${result.lineIndex}-${i}`}>
                <Text inverse={isSelected} color={isSelected ? "magenta" : undefined}>
                  {isSelected ? ">" : " "}
                </Text>
                <Text inverse={isSelected} color="cyan" dimColor={!isSelected}>
                  {" "}[{result.sessionName}]{" "}
                </Text>
                <Text inverse={isSelected}>
                  {isSelected ? lineText : lineText}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Footer */}
      <Text dimColor>↑/↓ navigate | Enter jump | Esc close | searches all tabs</Text>
    </Box>
  );
}

function truncateLine(line: string, maxLen: number): string {
  if (maxLen < 10) maxLen = 10;
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 1) + "…";
}
