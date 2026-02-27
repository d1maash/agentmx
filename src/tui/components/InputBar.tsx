import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

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

      // Ignore control characters
      if (key.ctrl || key.meta) return;

      if (char) {
        setInput((prev) => prev + char);
      }
    },
    { isActive: focused }
  );

  if (!focused) {
    return (
      <Box paddingX={1} borderStyle="single" borderColor="gray">
        <Text dimColor>Press Enter to focus and type input for {agentName}</Text>
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
