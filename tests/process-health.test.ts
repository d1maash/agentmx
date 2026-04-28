import { describe, expect, it } from "vitest";
import { parsePsOutput } from "../src/core/process-health.js";

describe("parsePsOutput", () => {
  it("parses pid, cpu and rss columns from ps output", () => {
    const snapshots = parsePsOutput("123  2.5  20480\n456  0.1  512\n");

    expect(snapshots.get(123)).toEqual({
      cpuPercent: 2.5,
      memoryBytes: 20480 * 1024,
    });
    expect(snapshots.get(456)).toEqual({
      cpuPercent: 0.1,
      memoryBytes: 512 * 1024,
    });
  });

  it("ignores malformed rows", () => {
    const snapshots = parsePsOutput([
      "bad row",
      "123 missing",
      "789 4.2 4096",
    ].join("\n"));

    expect(Array.from(snapshots.keys())).toEqual([789]);
  });
});
