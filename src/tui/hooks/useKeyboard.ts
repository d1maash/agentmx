import { useState, useCallback, useEffect } from "react";
import { useInput } from "ink";

interface UseKeyboardOptions {
  sessionsCount: number;
  enabled?: boolean;
  onQuit: () => void;
  onNewAgent: () => void;
  onKillAgent: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  onPageUp?: () => void;
  onPageDown?: () => void;
  onScrollTop?: () => void;
  onScrollBottom?: () => void;
}

export function useKeyboard({
  sessionsCount,
  enabled = true,
  onQuit,
  onNewAgent,
  onKillAgent,
  onScrollUp,
  onScrollDown,
  onPageUp,
  onPageDown,
  onScrollTop,
  onScrollBottom,
}: UseKeyboardOptions) {
  const [activeIndex, setActiveIndex] = useState(0);

  const isHomeKey = (value: string): boolean =>
    value === "\u001b[H" || value === "\u001b[1~" || value === "\u001bOH";
  const isEndKey = (value: string): boolean =>
    value === "\u001b[F" || value === "\u001b[4~" || value === "\u001bOF";

  const clampIndex = useCallback(
    (index: number) => {
      if (sessionsCount <= 0) return 0;
      return Math.max(0, Math.min(index, sessionsCount - 1));
    },
    [sessionsCount]
  );

  // Keep active tab in range when sessions are added/removed.
  useEffect(() => {
    setActiveIndex((i) => clampIndex(i));
  }, [clampIndex]);

  useInput((input, key) => {
    if (!enabled) return;

    // Quick switch: number keys 1-9
    if (input >= "1" && input <= "9" && !key.ctrl && !key.meta) {
      const idx = parseInt(input, 10) - 1;
      if (idx < sessionsCount) {
        setActiveIndex(idx);
      }
      return;
    }

    // Arrow / Tab navigation
    if (key.leftArrow && sessionsCount > 0) {
      setActiveIndex((i) => clampIndex(i - 1));
    }
    if (key.rightArrow && sessionsCount > 0) {
      setActiveIndex((i) => clampIndex(i + 1));
    }
    if (key.tab && sessionsCount > 0) {
      setActiveIndex((i) => (i + 1) % sessionsCount);
      return;
    }

    // Scroll output view
    if (key.upArrow) {
      onScrollUp?.();
      return;
    }
    if (key.downArrow) {
      onScrollDown?.();
      return;
    }
    if (key.pageUp) {
      onPageUp?.();
      return;
    }
    if (key.pageDown) {
      onPageDown?.();
      return;
    }
    if (isHomeKey(input)) {
      onScrollTop?.();
      return;
    }
    if (isEndKey(input)) {
      onScrollBottom?.();
      return;
    }

    // NOTE: Enter/Esc for input mode is handled by App.tsx.

    // New agent (Ctrl+N)
    if (input === "n" && key.ctrl) {
      onNewAgent();
    }

    // Kill current agent (Ctrl+W)
    if (input === "w" && key.ctrl) {
      onKillAgent();
    }

    // Quit (Ctrl+Q or Ctrl+C)
    if (input === "q" && key.ctrl) {
      onQuit();
    }
  });

  const setActive = useCallback(
    (index: number) => {
      setActiveIndex(clampIndex(index));
    },
    [clampIndex]
  );

  // focused/setFocused kept for compatibility.
  return { activeIndex, focused: false, setFocused: () => {}, setActive };
}
