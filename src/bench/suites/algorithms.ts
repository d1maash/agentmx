import type { BenchSuite } from "../types.js";

export const algorithmsSuite: BenchSuite = {
  id: "algorithms",
  name: "Algorithms",
  description: "Classic algorithm problems: fibonacci, sorting, binary search, two-sum",
  problems: [
    {
      id: "fibonacci",
      name: "Fibonacci Function",
      prompt: `Create a file called src/fibonacci.ts that exports a function \`fibonacci(n: number): number\` which returns the nth Fibonacci number (0-indexed). fibonacci(0) = 0, fibonacci(1) = 1, fibonacci(2) = 1, fibonacci(10) = 55. It must handle n up to 40 efficiently (no exponential recursion).`,
      language: "typescript",
      difficulty: "easy",
      timeLimitSeconds: 120,
      scaffoldFiles: {
        "package.json": JSON.stringify(
          {
            name: "bench-fibonacci",
            private: true,
            type: "module",
            scripts: { test: "npx tsx --test test/fibonacci.test.ts" },
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
        "test/fibonacci.test.ts": `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fibonacci } from "../src/fibonacci.js";

describe("fibonacci", () => {
  it("returns 0 for n=0", () => {
    assert.equal(fibonacci(0), 0);
  });
  it("returns 1 for n=1", () => {
    assert.equal(fibonacci(1), 1);
  });
  it("returns 1 for n=2", () => {
    assert.equal(fibonacci(2), 1);
  });
  it("returns 55 for n=10", () => {
    assert.equal(fibonacci(10), 55);
  });
  it("returns 6765 for n=20", () => {
    assert.equal(fibonacci(20), 6765);
  });
  it("handles n=40 efficiently", () => {
    assert.equal(fibonacci(40), 102334155);
  });
});
`,
      },
      verifyCommand: "npx tsx --test test/fibonacci.test.ts",
      testCases: [
        { name: "base cases", command: "npx tsx --test test/fibonacci.test.ts" },
      ],
    },
    {
      id: "sorting",
      name: "Sorting Algorithm",
      prompt: `Create a file called src/sort.ts that exports a function \`mergeSort(arr: number[]): number[]\` which returns a new sorted array using the merge sort algorithm. Do not use Array.prototype.sort(). The function should not modify the input array.`,
      language: "typescript",
      difficulty: "easy",
      timeLimitSeconds: 120,
      scaffoldFiles: {
        "package.json": JSON.stringify(
          {
            name: "bench-sorting",
            private: true,
            type: "module",
            scripts: { test: "npx tsx --test test/sort.test.ts" },
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
        "test/sort.test.ts": `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeSort } from "../src/sort.js";

describe("mergeSort", () => {
  it("sorts an empty array", () => {
    assert.deepEqual(mergeSort([]), []);
  });
  it("sorts a single element", () => {
    assert.deepEqual(mergeSort([1]), [1]);
  });
  it("sorts already sorted array", () => {
    assert.deepEqual(mergeSort([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
  });
  it("sorts reverse sorted array", () => {
    assert.deepEqual(mergeSort([5, 4, 3, 2, 1]), [1, 2, 3, 4, 5]);
  });
  it("sorts array with duplicates", () => {
    assert.deepEqual(mergeSort([3, 1, 4, 1, 5, 9, 2, 6]), [1, 1, 2, 3, 4, 5, 6, 9]);
  });
  it("sorts negative numbers", () => {
    assert.deepEqual(mergeSort([-3, 0, -1, 5, 2]), [-3, -1, 0, 2, 5]);
  });
  it("does not modify original array", () => {
    const original = [3, 1, 2];
    const copy = [...original];
    mergeSort(original);
    assert.deepEqual(original, copy);
  });
});
`,
      },
      verifyCommand: "npx tsx --test test/sort.test.ts",
      testCases: [
        { name: "sort tests", command: "npx tsx --test test/sort.test.ts" },
      ],
    },
    {
      id: "binary-search",
      name: "Binary Search",
      prompt: `Create a file called src/binary-search.ts that exports a function \`binarySearch(arr: number[], target: number): number\` which returns the index of target in a sorted array, or -1 if not found. The array is sorted in ascending order. You must use binary search (O(log n)), not linear scan.`,
      language: "typescript",
      difficulty: "easy",
      timeLimitSeconds: 120,
      scaffoldFiles: {
        "package.json": JSON.stringify(
          {
            name: "bench-binary-search",
            private: true,
            type: "module",
            scripts: { test: "npx tsx --test test/binary-search.test.ts" },
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
        "test/binary-search.test.ts": `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { binarySearch } from "../src/binary-search.js";

describe("binarySearch", () => {
  it("finds element at beginning", () => {
    assert.equal(binarySearch([1, 3, 5, 7, 9], 1), 0);
  });
  it("finds element at end", () => {
    assert.equal(binarySearch([1, 3, 5, 7, 9], 9), 4);
  });
  it("finds element in middle", () => {
    assert.equal(binarySearch([1, 3, 5, 7, 9], 5), 2);
  });
  it("returns -1 for missing element", () => {
    assert.equal(binarySearch([1, 3, 5, 7, 9], 4), -1);
  });
  it("returns -1 for empty array", () => {
    assert.equal(binarySearch([], 1), -1);
  });
  it("works with single element found", () => {
    assert.equal(binarySearch([42], 42), 0);
  });
  it("works with single element not found", () => {
    assert.equal(binarySearch([42], 7), -1);
  });
  it("works with large array", () => {
    const arr = Array.from({ length: 10000 }, (_, i) => i * 2);
    assert.equal(binarySearch(arr, 5000), 2500);
    assert.equal(binarySearch(arr, 5001), -1);
  });
});
`,
      },
      verifyCommand: "npx tsx --test test/binary-search.test.ts",
      testCases: [
        { name: "binary search tests", command: "npx tsx --test test/binary-search.test.ts" },
      ],
    },
    {
      id: "two-sum",
      name: "Two Sum",
      prompt: `Create a file called src/two-sum.ts that exports a function \`twoSum(nums: number[], target: number): [number, number]\` which returns the indices of two numbers that add up to target. You may assume each input has exactly one solution and you may not use the same element twice. Return the indices in ascending order.`,
      language: "typescript",
      difficulty: "medium",
      timeLimitSeconds: 120,
      scaffoldFiles: {
        "package.json": JSON.stringify(
          {
            name: "bench-two-sum",
            private: true,
            type: "module",
            scripts: { test: "npx tsx --test test/two-sum.test.ts" },
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
        "test/two-sum.test.ts": `import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { twoSum } from "../src/two-sum.js";

describe("twoSum", () => {
  it("finds pair in simple array", () => {
    assert.deepEqual(twoSum([2, 7, 11, 15], 9), [0, 1]);
  });
  it("finds pair not at start", () => {
    assert.deepEqual(twoSum([3, 2, 4], 6), [1, 2]);
  });
  it("handles duplicates", () => {
    assert.deepEqual(twoSum([3, 3], 6), [0, 1]);
  });
  it("finds pair with negatives", () => {
    assert.deepEqual(twoSum([-1, 0, 3, 4], 3), [0, 2]);
  });
  it("finds pair in larger array", () => {
    const result = twoSum([1, 5, 8, 3, 9, 2], 11), [0, 1];
    assert.equal(result.length, 2);
    const [i, j] = result;
    assert.equal([1, 5, 8, 3, 9, 2][i] + [1, 5, 8, 3, 9, 2][j], 11);
    assert.ok(i < j);
  });
});
`,
      },
      verifyCommand: "npx tsx --test test/two-sum.test.ts",
      testCases: [
        { name: "two sum tests", command: "npx tsx --test test/two-sum.test.ts" },
      ],
    },
  ],
};
