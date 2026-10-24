import * as path from "node:path";
import { runCommand } from "./util.js";

export interface GitFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "unknown";
}

export interface GitState {
  isRepo: boolean;
  root: string | null;
  branch: string | null;
  head: string | null;
  lastCommit: { hash: string; subject: string; date: string } | null;
  changes: GitFileChange[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  diffStat: string;
  /** Relative paths of every file that differs from HEAD (including untracked). */
  changedFiles: string[];
}

function git(root: string, args: string[], timeoutMs = 30_000) {
  return runCommand("git", args, { cwd: root, timeoutMs });
}

/** Collect the current Git state of `root` (works on any directory inside a repo). */
export function gitState(root: string): GitState {
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  const empty: GitState = {
    isRepo: false,
    root: null,
    branch: null,
    head: null,
    lastCommit: null,
    changes: [],
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    diffStat: "",
    changedFiles: [],
  };
  if (top.code !== 0) return empty;

  const repoRoot = top.stdout.trim().replace(/\\/g, "/");
  const branch = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  const log = git(repoRoot, ["log", "-1", "--format=%H|%s|%cI"]);

  const status = git(repoRoot, ["status", "--porcelain=v1", "-uall"]);
  const changes: GitFileChange[] = [];
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;

  for (const line of status.stdout.split("\n")) {
    if (!line.trim()) continue;
    const x = line[0];
    const y = line[1];
    let file = line.slice(3).trim();
    // Renames arrive as "old -> new"; keep the new path.
    const arrow = file.indexOf(" -> ");
    if (arrow >= 0) file = file.slice(arrow + 4);
    file = file.replace(/^"|"$/g, "");

    let st: GitFileChange["status"] = "unknown";
    if (x === "?" && y === "?") {
      st = "untracked";
      untrackedCount++;
    } else {
      if (x !== " " && x !== "?") stagedCount++;
      if (y !== " " && y !== "?") unstagedCount++;
      const code = (x !== " " && x !== "?" ? x : y).toUpperCase();
      if (code === "A") st = "added";
      else if (code === "M") st = "modified";
      else if (code === "D") st = "deleted";
      else if (code === "R") st = "renamed";
    }
    changes.push({ path: file.replace(/\\/g, "/"), status: st });
  }

  const diffStat = git(repoRoot, ["diff", "--stat", "HEAD"]);
  const changedFiles = Array.from(new Set(changes.map((c) => c.path)));

  return {
    isRepo: true,
    root: repoRoot,
    branch: branch.code === 0 ? branch.stdout.trim() : null,
    head: head.code === 0 ? head.stdout.trim() : null,
    lastCommit:
      log.code === 0 && log.stdout.trim()
        ? (() => {
            const [hash, subject, date] = log.stdout.trim().split("|");
            return { hash, subject, date };
          })()
        : null,
    changes,
    stagedCount,
    unstagedCount,
    untrackedCount,
    diffStat: diffStat.stdout.trim(),
    changedFiles,
  };
}

/** Record of the working tree at task start, used to preserve pre-existing user changes. */
export interface Baseline {
  takenAt: string;
  head: string | null;
  dirtyFiles: string[];
}

export function takeBaseline(root: string): Baseline {
  const s = gitState(root);
  return {
    takenAt: new Date().toISOString(),
    head: s.head,
    dirtyFiles: s.changedFiles,
  };
}
