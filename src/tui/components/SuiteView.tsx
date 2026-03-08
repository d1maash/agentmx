import React, { useState, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import type { SuiteOrchestrator } from "../../bench/orchestrator.js";
import type { SuiteEvent, ProblemResult, SuiteRunResult } from "../../bench/types.js";

interface SuiteViewProps {
  orchestrator: SuiteOrchestrator;
  onResults: (results: SuiteRunResult[]) => void;
}

interface ProblemProgress {
  problemId: string;
  problemName: string;
  agentStatuses: Map<string, "pending" | "running" | "done">;
  agentResults: Map<string, ProblemResult>;
}

function statusIcon(status: "pending" | "running" | "done", result?: ProblemResult): string {
  if (status === "pending") return "○";
  if (status === "running") return "⏳";
  if (!result) return "✅";
  if (result.timedOut) return "⏰";
  if (result.passed) return "✅";
  return "❌";
}

function formatTime(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

export function SuiteView({ orchestrator, onResults }: SuiteViewProps) {
  const { exit } = useApp();
  const [currentSuite, setCurrentSuite] = useState<string>("");
  const [problems, setProblems] = useState<Map<string, ProblemProgress>>(new Map());
  const [done, setDone] = useState(false);
  const [suiteResults, setSuiteResults] = useState<SuiteRunResult[]>([]);

  const agentNames = orchestrator.getAgentNames();

  useEffect(() => {
    const handler = (event: SuiteEvent) => {
      switch (event.type) {
        case "suite:start":
          setCurrentSuite(event.suiteName);
          break;

        case "problem:start":
          setProblems((prev) => {
            const next = new Map(prev);
            const agentStatuses = new Map<string, "pending" | "running" | "done">();
            for (const name of agentNames) {
              agentStatuses.set(name, "pending");
            }
            next.set(event.problemId, {
              problemId: event.problemId,
              problemName: event.problemName,
              agentStatuses,
              agentResults: new Map(),
            });
            return next;
          });
          break;

        case "agent:start":
          setProblems((prev) => {
            const next = new Map(prev);
            const problem = next.get(event.problemId);
            if (problem) {
              problem.agentStatuses.set(event.agentName, "running");
            }
            return next;
          });
          break;

        case "agent:done":
          setProblems((prev) => {
            const next = new Map(prev);
            const problem = next.get(event.problemId);
            if (problem) {
              problem.agentStatuses.set(event.agentName, "done");
              problem.agentResults.set(event.agentName, event.result);
            }
            return next;
          });
          break;

        case "suite:done":
          setSuiteResults((prev) => [...prev, event.result]);
          break;
      }
    };

    orchestrator.on("event", handler);

    // Start the orchestrator
    orchestrator.run().then((results) => {
      onResults(results);
      setDone(true);
    });

    return () => {
      orchestrator.off("event", handler);
    };
  }, [orchestrator]);

  // Exit after results are shown
  useEffect(() => {
    if (done) {
      const timer = setTimeout(() => exit(), 500);
      return () => clearTimeout(timer);
    }
  }, [done, exit]);

  const problemList = Array.from(problems.values());

  if (done && suiteResults.length > 0) {
    // Final results view
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Suite Benchmark Complete</Text>
        <Text>{""}</Text>
        {suiteResults.map((suite) => {
          const agentSummaries: Array<{
            name: string;
            passed: number;
            total: number;
            timeMs: number;
            cost: number | undefined;
          }> = [];

          for (const [agentName, results] of suite.agentResults) {
            const passed = results.filter((r) => r.passed).length;
            const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);
            const costs = results.map((r) => r.cost).filter((c): c is number => c !== undefined);
            const totalCost = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : undefined;
            agentSummaries.push({
              name: orchestrator.getDisplayName(agentName),
              passed,
              total: results.length,
              timeMs: totalTime,
              cost: totalCost,
            });
          }

          // Sort by pass count descending, then time ascending
          agentSummaries.sort((a, b) => {
            if (a.passed !== b.passed) return b.passed - a.passed;
            return a.timeMs - b.timeMs;
          });

          const maxName = Math.max(...agentSummaries.map((a) => a.name.length), 5);

          return (
            <Box key={suite.suiteId} flexDirection="column">
              <Text bold>  {suite.suiteName}</Text>
              <Text dimColor>
                {"  "}{"Agent".padEnd(maxName)}{"   Pass Rate   Time        Cost"}
              </Text>
              <Text dimColor>{"  " + "─".repeat(maxName + 35)}</Text>
              {agentSummaries.map((a, i) => {
                const passStr = `${a.passed}/${a.total}`;
                const timeStr = formatTime(a.timeMs);
                const costStr = a.cost !== undefined ? "$" + a.cost.toFixed(4) : "—";
                const icon = a.passed === a.total ? "🏆" : i === 0 ? "🥇" : "";
                return (
                  <Text key={a.name}>
                    {"  "}{a.name.padEnd(maxName)}{"   "}{passStr.padEnd(11)}{timeStr.padStart(7)}{"   "}{costStr.padStart(8)}{"  "}{icon}
                  </Text>
                );
              })}
              <Text>{""}</Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  // Live progress view
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>amx bench suite — {currentSuite || "starting..."}</Text>
      <Text>{""}</Text>
      {problemList.map((problem) => (
        <Box key={problem.problemId} flexDirection="column" marginBottom={1}>
          <Text>  {problem.problemName}</Text>
          {agentNames.map((agentName) => {
            const status = problem.agentStatuses.get(agentName) ?? "pending";
            const result = problem.agentResults.get(agentName);
            const displayName = orchestrator.getDisplayName(agentName);
            const icon = statusIcon(status, result);

            let detail = "";
            if (result) {
              detail = result.passed
                ? ` ${formatTime(result.timeMs)}`
                : result.timedOut
                  ? " timeout"
                  : ` fail (${result.passedCount}/${result.totalCount})`;
            }

            return (
              <Text key={agentName} dimColor={status === "pending"}>
                {"    "}{icon} {displayName}{detail}
              </Text>
            );
          })}
        </Box>
      ))}
      {problemList.length === 0 && (
        <Text dimColor>  Preparing workspaces...</Text>
      )}
    </Box>
  );
}
