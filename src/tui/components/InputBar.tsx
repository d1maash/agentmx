import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

// Matches ANSI escape sequences like [?62c, CSI sequences, OSC, etc.
const ANSI_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]|\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\x1b[\x20-\x2f]*[\x30-\x7e]|\[[\?]?[0-9;]*[a-zA-Z]/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

function isPrintable(char: string): boolean {
  if (!char || char.length === 0) return false;
  const code = char.charCodeAt(0);
  // Allow printable ASCII + unicode (letters, digits, symbols, spaces)
  return code >= 0x20 && code !== 0x7f;
}

interface InputBarProps {
  agentName: string;
  focused: boolean;
  onSubmit: (text: string) => void;
}

export function InputBar({ agentName, focused, onSubmit }: InputBarProps) {
  const [input, setInput] = useState("");

  useInput(
    (char, key) => {
      if (!focused) return;

      if (key.return) {
        if (input.trim()) {
          onSubmit(input + "\n");
          setInput("");
        }
        return;
      }

      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      // Ignore control/meta/arrow keys
      if (key.ctrl || key.meta) return;
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
      if (key.escape || key.tab) return;

      if (char) {
        // Strip any ANSI sequences that sneak through (terminal DA responses etc.)
        const clean = stripAnsi(char);
        if (clean && isPrintable(clean)) {
          setInput((prev) => prev + clean);
        }
      }
    },
    { isActive: focused }
  );

  if (!focused) {
    return (
      <Box paddingX={1} borderStyle="single" borderColor="gray">
        <Text dimColor>Press Enter to type input for {agentName}</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1} borderStyle="single" borderColor="cyan">
      <Text color="cyan" bold>
        {agentName} {">"}{" "}
      </Text>
      <Text>{input}</Text>
      <Text color="cyan">█</Text>
    </Box>
  );
}
