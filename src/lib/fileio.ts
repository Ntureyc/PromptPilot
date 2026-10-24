import * as fs from "node:fs";

/** Read a text file with a hard character cap; returns null when unreadable. */
export function readTextFile(file: string, maxChars = 20_000): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const text = fs.readFileSync(file, "utf8");
    return text.length > maxChars ? text.slice(0, maxChars) + "\n… [truncated]" : text;
  } catch {
    return null;
  }
}
