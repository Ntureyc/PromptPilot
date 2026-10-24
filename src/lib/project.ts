import * as fs from "node:fs";
import * as path from "node:path";
import { IGNORED_DIRS, truncate } from "./util.js";
import { gitState, GitState } from "./git.js";

export interface ManifestInfo {
  kind: string;
  file: string;
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface InstructionFile {
  file: string;
  excerpt: string;
}

export interface ProjectInspection {
  root: string;
  inspectedAt: string;
  projectType: string;
  manifests: ManifestInfo[];
  instructionFiles: InstructionFile[];
  detectedStack: string[];
  frameworks: string[];
  scripts: Record<string, string>;
  structure: { top: string[]; fileCount: number; byExtension: Record<string, number> };
  git: GitState;
  notes: string[];
}

const INSTRUCTION_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  "CLAUDE.local.md",
  ".cursorrules",
  ".cursor/rules/default.mdc",
  ".github/copilot-instructions.md",
  "README.md",
];

const STACK_SIGNALS: Array<[string, string[]]> = [
  ["typescript", ["typescript", "tsconfig.json"]],
  ["next.js", ["next"]],
  ["react", ["react", "react-dom"]],
  ["vue", ["vue"]],
  ["svelte", ["svelte", "@sveltejs/kit"]],
  ["nuxt", ["nuxt"]],
  ["express", ["express"]],
  ["fastify", ["fastify"]],
  ["nestjs", ["@nestjs/core"]],
  ["tailwindcss", ["tailwindcss"]],
  ["prisma", ["prisma", "@prisma/client"]],
  ["drizzle", ["drizzle-orm"]],
  ["vite", ["vite"]],
  ["vitest", ["vitest"]],
  ["jest", ["jest"]],
  ["playwright", ["@playwright/test"]],
  ["eslint", ["eslint"]],
  ["prettier", ["prettier"]],
  ["bun", ["bun-types"]],
  ["python", ["pyproject.toml", "requirements.txt", "setup.py"]],
  ["fastapi", ["fastapi"]],
  ["django", ["django"]],
  ["flask", ["flask"]],
  ["go", ["go.mod"]],
  ["rust", ["Cargo.toml"]],
  ["docker", ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml"]],
];

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(file: string, max: number): string | null {
  try {
    return truncate(fs.readFileSync(file, "utf8"), max);
  } catch {
    return null;
  }
}

function detectManifests(root: string): ManifestInfo[] {
  const out: ManifestInfo[] = [];
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = readJson(pkgPath) as Record<string, unknown> | null;
    if (pkg) {
      out.push({
        kind: "npm",
        file: "package.json",
        name: typeof pkg.name === "string" ? pkg.name : undefined,
        version: typeof pkg.version === "string" ? pkg.version : undefined,
        scripts: (pkg.scripts as Record<string, string>) ?? {},
        dependencies: (pkg.dependencies as Record<string, string>) ?? {},
        devDependencies: (pkg.devDependencies as Record<string, string>) ?? {},
      });
    }
  }
  const simple: Array<[string, string]> = [
    ["pyproject.toml", "python"],
    ["requirements.txt", "python"],
    ["go.mod", "go"],
    ["Cargo.toml", "rust"],
    ["pom.xml", "maven"],
    ["build.gradle", "gradle"],
    ["build.gradle.kts", "gradle"],
    ["composer.json", "php"],
    ["Gemfile", "ruby"],
  ];
  for (const [file, kind] of simple) {
    if (fs.existsSync(path.join(root, file))) out.push({ kind, file });
  }
  return out;
}

function detectStack(root: string, manifests: ManifestInfo[]): { stack: string[]; frameworks: string[] } {
  const depNames = new Set<string>();
  for (const m of manifests) {
    for (const k of Object.keys(m.dependencies ?? {})) depNames.add(k.toLowerCase());
    for (const k of Object.keys(m.devDependencies ?? {})) depNames.add(k.toLowerCase());
    if (m.kind === "python" || m.kind === "go" || m.kind === "rust") depNames.add(m.kind);
    if (m.file === "pyproject.toml") depNames.add("pyproject.toml");
    if (m.file === "requirements.txt") depNames.add("requirements.txt");
    if (m.file === "go.mod") depNames.add("go.mod");
    if (m.file === "Cargo.toml") depNames.add("Cargo.toml");
  }

  const stack: string[] = [];
  const frameworks: string[] = [];
  for (const [label, signals] of STACK_SIGNALS) {
    const hit = signals.some(
      (s) => depNames.has(s.toLowerCase()) || fs.existsSync(path.join(root, s))
    );
    if (!hit) continue;
    if (["typescript", "python", "go", "rust", "docker"].includes(label)) stack.push(label);
    else frameworks.push(label);
  }
  return { stack: Array.from(new Set(stack)), frameworks: Array.from(new Set(frameworks)) };
}

function scanStructure(root: string): ProjectInspection["structure"] {
  const top: string[] = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      top.push(entry.name + (entry.isDirectory() ? "/" : ""));
      if (top.length >= 60) break;
    }
  } catch {
    /* unreadable root: leave structure empty */
  }

  const byExtension: Record<string, number> = {};
  let fileCount = 0;
  const walk = (dir: string, depth: number) => {
    if (fileCount >= 5000 || depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (fileCount >= 5000) return;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else {
        fileCount++;
        const ext = entry.name.includes(".")
          ? "." + entry.name.split(".").pop()!.toLowerCase()
          : "(none)";
        byExtension[ext] = (byExtension[ext] ?? 0) + 1;
      }
    }
  };
  walk(root, 0);

  const sorted = Object.fromEntries(
    Object.entries(byExtension)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
  );
  return { top, fileCount, byExtension: sorted };
}

/** Discover project structure, instructions, stack, and current Git state. */
export function inspectProject(root: string): ProjectInspection {
  const absRoot = path.resolve(root);
  const notes: string[] = [];
  const manifests = detectManifests(absRoot);
  if (manifests.length === 0) {
    notes.push("No recognized manifest found — project type unknown; verify manually.");
  }

  const instructionFiles: InstructionFile[] = [];
  for (const cand of INSTRUCTION_CANDIDATES) {
    const text = readText(path.join(absRoot, cand), 2500);
    if (text !== null) instructionFiles.push({ file: cand, excerpt: text });
  }

  const { stack, frameworks } = detectStack(absRoot, manifests);
  const git = gitState(absRoot);
  if (git.isRepo && git.changedFiles.length > 0) {
    notes.push(
      `Working tree is dirty (${git.changedFiles.length} changed/untracked files) — pre-existing changes must be preserved.`
    );
  }

  const scripts: Record<string, string> = {};
  for (const m of manifests) Object.assign(scripts, m.scripts ?? {});

  return {
    root: absRoot.replace(/\\/g, "/"),
    inspectedAt: new Date().toISOString(),
    projectType:
      manifests.length > 0
        ? Array.from(new Set(manifests.map((m) => m.kind))).join("+")
        : "unknown",
    manifests,
    instructionFiles,
    detectedStack: stack,
    frameworks,
    scripts,
    structure: scanStructure(absRoot),
    git,
    notes,
  };
}
