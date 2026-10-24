import { test, expect } from "bun:test";
import { globToRegExp, matchesGlob, truncate } from "../src/lib/util.js";

test("globToRegExp matches simple patterns", () => {
  expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
  expect(globToRegExp("src/*.ts").test("src/nested/a.ts")).toBe(false);
});

test("glob ** crosses directories", () => {
  expect(globToRegExp("src/**/*.ts").test("src/a.ts")).toBe(true);
  expect(globToRegExp("src/**/*.ts").test("src/deep/nested/a.ts")).toBe(true);
  expect(matchesGlob("src/deep/a.ts", ["src/**"])).toBe(true);
});

test("bare directory name covers its contents", () => {
  expect(matchesGlob("src/anything/file.ts", ["src"])).toBe(true);
  expect(matchesGlob("other/file.ts", ["src"])).toBe(false);
});

test("special regex characters are escaped", () => {
  expect(globToRegExp("a+b.txt").test("a+b.txt")).toBe(true);
  expect(globToRegExp("a+b.txt").test("aab.txt")).toBe(false);
});

test("truncate marks the cut", () => {
  expect(truncate("hello", 10)).toBe("hello");
  expect(truncate("hello world", 5)).toContain("truncated 6 chars");
});
