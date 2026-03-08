import type { BenchSuite } from "../types.js";

export const practicalSuite: BenchSuite = {
  id: "practical",
  name: "Practical",
  description: "Real-world tasks: REST endpoint, CLI tool, file parser, data transformer",
  problems: [
    {
      id: "rest-endpoint",
      name: "REST API Endpoint",
      prompt: `Create a file called src/server.ts that exports a function \`createApp()\` returning an HTTP server (using Node.js built-in http module, no frameworks). The server should handle:

- GET /todos — returns JSON array of all todos
- POST /todos — accepts JSON body { "title": string }, creates a todo with auto-incrementing id, completed: false, returns the created todo with 201 status
- PATCH /todos/:id — accepts JSON body { "completed": boolean }, updates the todo, returns updated todo (404 if not found)
- DELETE /todos/:id — deletes the todo, returns 204 (404 if not found)

Todos are stored in-memory (array). Each todo has: { id: number, title: string, completed: boolean }.`,
      language: "typescript",
      difficulty: "medium",
      timeLimitSeconds: 180,
      scaffoldFiles: {
        "package.json": JSON.stringify(
          {
            name: "bench-rest-endpoint",
            private: true,
            type: "module",
            scripts: { test: "npx tsx --test test/server.test.ts" },
            devDependencies: { tsx: "^4.19.0", typescript: "^5.5.0" },
          },
          null,
          2
        ),
        "tsconfig.json": JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: true,
              outDir: "dist",
              declaration: true,
              esModuleInterop: true,
            },
            include: ["src", "test"],
          },
          null,
          2
        ),
        "test/server.test.ts": `import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";

let server: Server;
let baseUrl: string;

async function req(path: string, opts?: RequestInit) {
  const res = await fetch(baseUrl + path, opts);
  const body = res.headers.get("content-type")?.includes("json")
    ? await res.json()
    : await res.text();
  return { status: res.status, body };
}

describe("Todo API", () => {
  before(async () => {
    server = createApp();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 3000;
    baseUrl = \`http://localhost:\${port}\`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /todos returns empty array initially", async () => {
    const { status, body } = await req("/todos");
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it("POST /todos creates a todo", async () => {
    const { status, body } = await req("/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Buy milk" }),
    });
    assert.equal(status, 201);
    assert.equal(body.title, "Buy milk");
    assert.equal(body.completed, false);
    assert.equal(typeof body.id, "number");
  });

  it("GET /todos returns created todo", async () => {
    const { body } = await req("/todos");
    assert.equal(body.length, 1);
    assert.equal(body[0].title, "Buy milk");
  });

  it("PATCH /todos/:id updates completion", async () => {
    const { body: todos } = await req("/todos");
    const id = todos[0].id;
    const { status, body } = await req(\`/todos/\${id}\`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    assert.equal(status, 200);
    assert.equal(body.completed, true);
  });

  it("DELETE /todos/:id removes todo", async () => {
    const { body: todos } = await req("/todos");
    const id = todos[0].id;
    const { status } = await req(\`/todos/\${id}\`, { method: "DELETE" });
    assert.equal(status, 204);
    const { body: remaining } = await req("/todos");
    assert.equal(remaining.length, 0);
  });

  it("PATCH /todos/:id returns 404 for missing", async () => {
    const { status } = await req("/todos/999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    assert.equal(status, 404);
  });

  it("DELETE /todos/:id returns 404 for missing", async () => {
    const { status } = await req("/todos/999", { method: "DELETE" });
    assert.equal(status, 404);
  });
});
`,
      },
      verifyCommand: "npx tsx --test test/server.test.ts",
      testCases: [
        { name: "REST API tests", command: "npx tsx --test test/server.test.ts" },
      ],
    },
    {
      id: "cli-tool",
      name: "CLI Word Counter",
      prompt: `Create a file called src/wordcount.ts that exports a function \`wordCount(text: string): { lines: number; words: number; chars: number }\` which counts lines, words, and characters in the given text. Words are separated by whitespace. Empty text returns all zeros. Lines are counted by newline characters (empty string = 0 lines, "hello" = 1 line, "hello\\nworld" = 2 lines).`,
      language: "typescript",
      difficulty: "easy",
      timeLimitSeconds: 120,
      scaffoldFiles: {
        "package.json": JSON.stringify(
          {
            name: "bench-cli-tool",
            private: true,
            type: "module",
            scripts: { test: "npx tsx --test test/wordcount.test.ts" },
            devDependencies: { tsx: "^4.19.0", typescript: "^5.5.0" },
          },
          null,
          2
        ),
        "tsconfig.json": JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: true,
              outDir: "dist",
              declaration: true,
              esModuleInterop: true,
            },
            include: ["src", "test"],
          },
          null,
          2
        ),
        "test/wordcount.test.ts": `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wordCount } from "../src/wordcount.js";

describe("wordCount", () => {
  it("handles empty string", () => {
    assert.deepEqual(wordCount(""), { lines: 0, words: 0, chars: 0 });
  });
  it("counts single word", () => {
    assert.deepEqual(wordCount("hello"), { lines: 1, words: 1, chars: 5 });
  });
  it("counts multiple words on one line", () => {
    assert.deepEqual(wordCount("hello world"), { lines: 1, words: 2, chars: 11 });
  });
  it("counts multiple lines", () => {
    assert.deepEqual(wordCount("hello\\nworld"), { lines: 2, words: 2, chars: 11 });
  });
  it("handles extra whitespace", () => {
    const result = wordCount("  hello   world  ");
    assert.equal(result.words, 2);
  });
  it("counts chars including whitespace", () => {
    assert.equal(wordCount("a b").chars, 3);
  });
  it("handles multiple blank lines", () => {
    const result = wordCount("hello\\n\\n\\nworld");
    assert.equal(result.lines, 4);
    assert.equal(result.words, 2);
  });
});
`,
      },
      verifyCommand: "npx tsx --test test/wordcount.test.ts",
      testCases: [
        { name: "wordcount tests", command: "npx tsx --test test/wordcount.test.ts" },
      ],
    },
    {
      id: "csv-parser",
      name: "CSV Parser",
      prompt: `Create a file called src/csv.ts that exports a function \`parseCSV(input: string): Record<string, string>[]\` which parses CSV text into an array of objects. The first row is the header row. Handle quoted fields (fields wrapped in double quotes that may contain commas and newlines). Handle escaped quotes within quoted fields (doubled double-quotes: ""). Return each row as an object mapping header names to string values.`,
      language: "typescript",
      difficulty: "medium",
      timeLimitSeconds: 180,
      scaffoldFiles: {
        "package.json": JSON.stringify(
          {
            name: "bench-csv-parser",
            private: true,
            type: "module",
            scripts: { test: "npx tsx --test test/csv.test.ts" },
            devDependencies: { tsx: "^4.19.0", typescript: "^5.5.0" },
          },
          null,
          2
        ),
        "tsconfig.json": JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: true,
              outDir: "dist",
              declaration: true,
              esModuleInterop: true,
            },
            include: ["src", "test"],
          },
          null,
          2
        ),
        "test/csv.test.ts": `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCSV } from "../src/csv.js";

describe("parseCSV", () => {
  it("parses simple CSV", () => {
    const input = "name,age\\nAlice,30\\nBob,25";
    const result = parseCSV(input);
    assert.deepEqual(result, [
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
  });

  it("handles quoted fields with commas", () => {
    const input = 'name,address\\nAlice,"123 Main St, Apt 4"';
    const result = parseCSV(input);
    assert.equal(result[0].address, "123 Main St, Apt 4");
  });

  it("handles escaped quotes", () => {
    const input = 'name,quote\\nAlice,"She said ""hello"""';
    const result = parseCSV(input);
    assert.equal(result[0].quote, 'She said "hello"');
  });

  it("handles empty fields", () => {
    const input = "a,b,c\\n1,,3";
    const result = parseCSV(input);
    assert.deepEqual(result, [{ a: "1", b: "", c: "3" }]);
  });

  it("handles single row (header only)", () => {
    const input = "name,age";
    const result = parseCSV(input);
    assert.deepEqual(result, []);
  });

  it("handles quoted fields with newlines", () => {
    const input = 'name,bio\\nAlice,"Line 1\\nLine 2"';
    const result = parseCSV(input);
    assert.equal(result[0].bio, "Line 1\\nLine 2");
  });
});
`,
      },
      verifyCommand: "npx tsx --test test/csv.test.ts",
      testCases: [
        { name: "CSV parser tests", command: "npx tsx --test test/csv.test.ts" },
      ],
    },
    {
      id: "data-transformer",
      name: "Data Transformer",
      prompt: `Create a file called src/transform.ts that exports a function \`transformData(input: object[], transforms: Transform[]): object[]\` where:

type Transform =
  | { type: "rename"; from: string; to: string }
  | { type: "filter"; field: string; value: unknown }
  | { type: "map"; field: string; fn: string }  // fn is "upper" | "lower" | "trim"
  | { type: "sort"; field: string; order: "asc" | "desc" }

Also export the Transform type. The function applies transforms in order. "rename" renames a field. "filter" keeps only rows where field === value. "map" applies a string transformation to a field. "sort" sorts by a field. Do not modify the input array.`,
      language: "typescript",
      difficulty: "medium",
      timeLimitSeconds: 180,
      scaffoldFiles: {
        "package.json": JSON.stringify(
          {
            name: "bench-data-transformer",
            private: true,
            type: "module",
            scripts: { test: "npx tsx --test test/transform.test.ts" },
            devDependencies: { tsx: "^4.19.0", typescript: "^5.5.0" },
          },
          null,
          2
        ),
        "tsconfig.json": JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: true,
              outDir: "dist",
              declaration: true,
              esModuleInterop: true,
            },
            include: ["src", "test"],
          },
          null,
          2
        ),
        "test/transform.test.ts": `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { transformData, type Transform } from "../src/transform.js";

describe("transformData", () => {
  const data = [
    { name: "Alice", age: 30, city: "NYC" },
    { name: "Bob", age: 25, city: "LA" },
    { name: "Charlie", age: 35, city: "NYC" },
  ];

  it("renames a field", () => {
    const transforms: Transform[] = [{ type: "rename", from: "name", to: "fullName" }];
    const result = transformData(data, transforms);
    assert.equal(result[0].fullName, "Alice");
    assert.equal((result[0] as any).name, undefined);
  });

  it("filters by field value", () => {
    const transforms: Transform[] = [{ type: "filter", field: "city", value: "NYC" }];
    const result = transformData(data, transforms);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "Alice");
    assert.equal(result[1].name, "Charlie");
  });

  it("maps field with upper", () => {
    const transforms: Transform[] = [{ type: "map", field: "name", fn: "upper" }];
    const result = transformData(data, transforms);
    assert.equal(result[0].name, "ALICE");
  });

  it("maps field with lower", () => {
    const transforms: Transform[] = [{ type: "map", field: "city", fn: "lower" }];
    const result = transformData(data, transforms);
    assert.equal(result[0].city, "nyc");
  });

  it("sorts ascending", () => {
    const transforms: Transform[] = [{ type: "sort", field: "age", order: "asc" }];
    const result = transformData(data, transforms);
    assert.equal(result[0].name, "Bob");
    assert.equal(result[2].name, "Charlie");
  });

  it("sorts descending", () => {
    const transforms: Transform[] = [{ type: "sort", field: "age", order: "desc" }];
    const result = transformData(data, transforms);
    assert.equal(result[0].name, "Charlie");
  });

  it("applies multiple transforms in order", () => {
    const transforms: Transform[] = [
      { type: "filter", field: "city", value: "NYC" },
      { type: "sort", field: "age", order: "asc" },
      { type: "map", field: "name", fn: "upper" },
    ];
    const result = transformData(data, transforms);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "ALICE");
    assert.equal(result[1].name, "CHARLIE");
  });

  it("does not modify original array", () => {
    const copy = JSON.parse(JSON.stringify(data));
    transformData(data, [{ type: "rename", from: "name", to: "x" }]);
    assert.deepEqual(data, copy);
  });
});
`,
      },
      verifyCommand: "npx tsx --test test/transform.test.ts",
      testCases: [
        { name: "transform tests", command: "npx tsx --test test/transform.test.ts" },
      ],
    },
  ],
};
