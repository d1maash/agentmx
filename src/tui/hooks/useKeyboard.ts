import { useState, useCallback } from "react";
import { useInput } from "ink";

interface UseKeyboardOptions {
  sessionsCount: number;
  onQuit: () => void;
}

export function useKeyboard({ sessionsCount, onQuit }: UseKeyboardOptions) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);

  useInput((input, key) => {
    if (focused) {
      // In focused mode, only Escape exits
      if (key.escape) {
        setFocused(false);
      }
      return;
    }

    // Navigation
    if (key.leftArrow) {
      setActiveIndex((i) => Math.max(0, i - 1));
    }
    if (key.rightArrow) {
      setActiveIndex((i) => Math.min(sessionsCount - 1, i + 1));
    }
    if (key.tab) {
      setActiveIndex((i) => (i + 1) % Math.max(1, sessionsCount));
    }

    // Focus on active agent
    if (key.return) {
      setFocused(true);
    }

    // Quit
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
