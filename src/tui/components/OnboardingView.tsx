import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { detectAgents, type KnownAgent } from "../../config/detect.js";

interface OnboardingViewProps {
  agents: string[];
  onComplete: (launchAgent?: string) => void;
}

const TOTAL_STEPS = 4;

export function OnboardingView({ agents, onComplete }: OnboardingViewProps) {
  const [step, setStep] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(0);
  const [detectedAgents] = useState<KnownAgent[]>(() => detectAgents());

  const installedAgents = detectedAgents.filter((a) => a.installed);

  useInput((input, key) => {
    // Skip onboarding
    if (key.escape) {
      onComplete();
      return;
    }

    if (step < TOTAL_STEPS - 1) {
      // Navigate forward
      if (key.return || key.rightArrow) {
        setStep((s) => s + 1);
      }
      // Navigate back
      if (key.leftArrow && step > 0) {
        setStep((s) => s - 1);
      }
    } else {
      // Last step: agent selection
      if (key.upArrow) {
        setSelectedAgent((i) => Math.max(0, i - 1));
      }
      if (key.downArrow) {
        setSelectedAgent((i) => Math.min(agents.length, i + 1));
        // agents.length = "skip" option
      }
      if (key.return) {
        if (selectedAgent < agents.length) {
          onComplete(agents[selectedAgent]);
        } else {
          onComplete();
        }
      }
      if (key.leftArrow) {
        setStep((s) => s - 1);
      }
    }
  });

  const dots = Array.from({ length: TOTAL_STEPS }, (_, i) =>
    i === step ? "●" : "○"
  ).join(" ");

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height="100%"
      width="100%"
      paddingX={2}
    >
      {step === 0 && <WelcomeStep />}
      {step === 1 && <AgentsStep detected={detectedAgents} />}
      {step === 2 && <ShortcutsStep />}
      {step === 3 && (
        <QuickStartStep
          agents={agents}
          selectedIndex={selectedAgent}
        />
      )}

      <Box marginTop={1}>
        <Text dimColor>{dots}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {step < TOTAL_STEPS - 1
            ? "Enter / → next  |  ← back  |  Esc skip"
            : "↑/↓ select  |  Enter confirm  |  ← back  |  Esc skip"}
        </Text>
      </Box>
    </Box>
  );
}

function WelcomeStep() {
  return (
    <Box flexDirection="column" alignItems="center">
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {`
   ___                    _   __  ____  __
  / _ |___ ____ ___  ____/ /_ /  |/  / \\/ /
 / __ / _ \`/ -_) _ \\/ __/  _// /|_/ /\\  /
/_/ |_\\_, /\\__/_//_/\\__/\\__//_/  /_/ /_/
     /___/
`}
        </Text>
      </Box>
      <Text bold color="yellow">
        Welcome to AgentMX!
      </Text>
      <Box marginTop={1}>
        <Text>Run multiple AI coding agents side-by-side</Text>
      </Box>
      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text dimColor>Claude Code, Codex, Aider, Gemini,</Text>
        <Text dimColor>Copilot, Cursor, Goose — all in one terminal.</Text>
      </Box>
    </Box>
  );
}

function AgentsStep({ detected }: { detected: KnownAgent[] }) {
  const installed = detected.filter((a) => a.installed);
  const missing = detected.filter((a) => !a.installed);

  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold color="yellow">
        Agent Detection
      </Text>
      <Box marginTop={1}>
        <Text>
          Found <Text bold color="green">{installed.length}</Text> of{" "}
          <Text bold>{detected.length}</Text> supported agents on your system
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {installed.map((agent) => (
          <Box key={agent.name}>
            <Text color="green" bold>
              {"  ● "}
            </Text>
            <Text bold>{agent.displayName}</Text>
            <Text dimColor> ({agent.command})</Text>
            {agent.version && <Text dimColor> v{agent.version}</Text>}
          </Box>
        ))}
        {missing.map((agent) => (
          <Box key={agent.name}>
            <Text dimColor>
              {"  ○ "}
            </Text>
            <Text dimColor>{agent.displayName}</Text>
            <Text dimColor> ({agent.command})</Text>
          </Box>
        ))}
      </Box>

      {installed.length === 0 && (
        <Box marginTop={1}>
          <Text color="red">
            No agents found! Install at least one agent to get started.
          </Text>
        </Box>
      )}

      {missing.length > 0 && installed.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            Run `amx init` later to configure additional agents.
          </Text>
        </Box>
      )}
    </Box>
  );
}

function ShortcutsStep() {
  const shortcuts: [string, string][] = [
    ["Ctrl+N", "Start a new agent"],
    ["Ctrl+W", "Kill current agent"],
    ["Enter / Esc", "Toggle input mode"],
    ["1-9 / ←→ / Tab", "Switch between agent tabs"],
    ["↑↓ / PgUp PgDn", "Scroll output"],
    ["Ctrl+F", "Search output"],
    ["Ctrl+D", "Diff view (2+ agents)"],
    ["Ctrl+S", "Quick snippets"],
    ["Ctrl+A", "Analytics dashboard"],
    ["Ctrl+Q", "Quit"],
  ];

  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold color="yellow">
        Keyboard Shortcuts
      </Text>
      <Box marginTop={1} flexDirection="column">
        {shortcuts.map(([key, desc]) => (
          <Box key={key} width={45}>
            <Box width={22}>
              <Text bold color="cyan">
                {key}
              </Text>
            </Box>
            <Text>{desc}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Tip: Use `amx run "task"` to run tasks directly from the CLI.
        </Text>
      </Box>
    </Box>
  );
}

function QuickStartStep({
  agents,
  selectedIndex,
}: {
  agents: string[];
  selectedIndex: number;
}) {
  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold color="yellow">
        Quick Start
      </Text>
      <Box marginTop={1}>
        <Text>Launch an agent to get started:</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {agents.map((agent, i) => (
          <Text key={agent} inverse={i === selectedIndex}>
            {i === selectedIndex ? " > " : "   "}
            {agent}
          </Text>
        ))}
        <Text inverse={selectedIndex === agents.length}>
          {selectedIndex === agents.length ? " > " : "   "}
          <Text dimColor={selectedIndex !== agents.length}>
            Skip — I'll start later
          </Text>
        </Text>
      </Box>
    </Box>
  );
}
