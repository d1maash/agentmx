import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { type Snippet, loadSnippets, saveSnippet, deleteSnippet } from "../utils/snippets.js";

interface SnippetPickerProps {
  onSelect: (prompt: string) => void;
  onClose: () => void;
}

export function SnippetPicker({ onSelect, onClose }: SnippetPickerProps) {
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"list" | "add">("list");
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [editField, setEditField] = useState<"name" | "prompt">("name");

  useInput((input, key) => {
    if (mode === "add") {
      if (key.escape) {
        setMode("list");
        setNewName("");
        setNewPrompt("");
        return;
      }

      if (key.tab) {
        setEditField((f) => (f === "name" ? "prompt" : "name"));
        return;
      }

      if (key.return) {
        if (editField === "name" && newName.trim()) {
          setEditField("prompt");
          return;
        }
        if (editField === "prompt" && newPrompt.trim() && newName.trim()) {
          const s = saveSnippet(newName.trim(), newPrompt.trim());
          setSnippets((prev) => {
            const idx = prev.findIndex((p) => p.name === s.name);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = s;
              return next;
            }
            return [...prev, s];
          });
          setMode("list");
          setNewName("");
          setNewPrompt("");
          return;
        }
      }

      if (key.backspace || key.delete) {
        if (editField === "name") setNewName((p) => p.slice(0, -1));
        else setNewPrompt((p) => p.slice(0, -1));
        return;
      }

      if (key.ctrl || key.meta) return;
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;

      if (input && input.length === 1 && input.charCodeAt(0) >= 0x20) {
        if (editField === "name") setNewName((p) => p + input);
        else setNewPrompt((p) => p + input);
      }
      return;
    }

    // List mode
    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(snippets.length - 1, i + 1));
      return;
    }

    if (key.return && snippets.length > 0) {
      onSelect(snippets[selectedIndex].prompt);
      return;
    }

    // 'a' to add new snippet
    if (input === "a" && !key.ctrl && !key.meta) {
      setMode("add");
      setEditField("name");
      return;
    }

    // 'd' to delete selected snippet
    if (input === "d" && !key.ctrl && !key.meta && snippets.length > 0) {
      const name = snippets[selectedIndex].name;
      deleteSnippet(name);
      setSnippets((prev) => prev.filter((s) => s.name !== name));
      setSelectedIndex((i) => Math.min(i, Math.max(0, snippets.length - 2)));
      return;
    }
  });

  if (mode === "add") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="green" paddingX={1}>
        <Text bold color="green">New Snippet</Text>
        <Box>
          <Text color={editField === "name" ? "cyan" : "white"}>Name: </Text>
          <Text>{newName}</Text>
          {editField === "name" && <Text color="cyan">█</Text>}
        </Box>
        <Box>
          <Text color={editField === "prompt" ? "cyan" : "white"}>Prompt: </Text>
          <Text>{newPrompt}</Text>
          {editField === "prompt" && <Text color="cyan">█</Text>}
        </Box>
        <Text dimColor>Tab switch field | Enter confirm | Esc cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">Snippets</Text>
      {snippets.length === 0 ? (
        <Text dimColor>No snippets saved. Press 'a' to add one.</Text>
      ) : (
        snippets.map((snippet, i) => (
          <Box key={snippet.name}>
            <Text inverse={i === selectedIndex}>
              {i === selectedIndex ? " > " : "   "}
              <Text bold>{snippet.name}</Text>
              <Text dimColor> — {truncate(snippet.prompt, 50)}</Text>
            </Text>
          </Box>
        ))
      )}
      <Text dimColor>↑/↓ select | Enter use | a add | d delete | Esc close</Text>
    </Box>
  );
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\n/g, " ");
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
