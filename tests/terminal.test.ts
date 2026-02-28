import { describe, expect, it } from "vitest";
import {
  getTerminalViewportLinesFromOutputBuffer,
  getRecentTerminalLinesFromOutputBuffer,
  sanitizeTerminalText,
} from "../src/tui/utils/terminal.js";

describe("sanitizeTerminalText", () => {
  it("keeps only the latest carriage-return rewrite for the line", () => {
    const raw = "first draft\rfinal line\nnext";
    expect(sanitizeTerminalText(raw)).toBe("final line\nnext");
  });
});

describe("getRecentTerminalLinesFromOutputBuffer", () => {
  it("returns only the most recent non-empty lines", () => {
    const outputs = [
      { data: "one\ntwo\n" },
      { data: "three\n" },
      { data: "four\nfive\n" },
    ];

    expect(getRecentTerminalLinesFromOutputBuffer(outputs, 3)).toEqual([
      "three",
      "four",
      "five",
    ]);
  });
});

describe("getTerminalViewportLinesFromOutputBuffer", () => {
  it("returns a scrolled viewport when offset is set", () => {
    const outputs = [
      { data: "l1\nl2\nl3\n" },
      { data: "l4\nl5\nl6\n" },
    ];

    const viewport = getTerminalViewportLinesFromOutputBuffer(outputs, 2, 2);

    expect(viewport.lines).toEqual(["l3", "l4"]);
    expect(viewport.effectiveOffset).toBe(2);
    expect(viewport.maxOffset).toBe(4);
    expect(viewport.totalLines).toBe(6);
  });
});
