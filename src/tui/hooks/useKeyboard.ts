import { useState, useCallback } from "react";
import { useInput } from "ink";

interface UseKeyboardOptions {
  sessionsCount: number;
  onQuit: () => void;
  onNewAgent: () => void;
  onKillAgent: () => void;
}

export function useKeyboard({
  sessionsCount,
  onQuit,
  onNewAgent,
  onKillAgent,
}: UseKeyboardOptions) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);

  useInput((input, key) => {
    // In focused mode: Escape exits focus, Ctrl+Q quits
    if (focused) {
      if (key.escape) {
        setFocused(false);
      }
      if (input === "q" && key.ctrl) {
        onQuit();
      }
      return;
    }

    // Quick switch: number keys 1-9
    if (input >= "1" && input <= "9" && !key.ctrl && !key.meta) {
      const idx = parseInt(input, 10) - 1;
      if (idx < sessionsCount) {
        setActiveIndex(idx);
      }
      return;
    }

    // Arrow / Tab navigation
    if (key.leftArrow) {
      setActiveIndex((i) => Math.max(0, i - 1));
    }
    if (key.rightArrow) {
      setActiveIndex((i) => Math.min(sessionsCount - 1, i + 1));
    }
    if (key.tab) {
      setActiveIndex((i) => (i + 1) % Math.max(1, sessionsCount));
    }

    // Focus on active agent (Enter)
    if (key.return && sessionsCount > 0) {
      setFocused(true);
    }

    // New agent (Ctrl+N)
    if (input === "n" && key.ctrl) {
      onNewAgent();
    }

    // Kill current agent (Ctrl+W)
    if (input === "w" && key.ctrl) {
      onKillAgent();
    }

    // Quit (Ctrl+Q)
    if (input === "q" && key.ctrl) {
      onQuit();
    }
  });

  const setActive = useCallback(
    (index: number) => {
      if (index >= 0 && index < sessionsCount) {
        setActiveIndex(index);
      }
    },
    [sessionsCount]
  );

  return { activeIndex, focused, setFocused, setActive };
}
