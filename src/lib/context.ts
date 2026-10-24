import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { readTextFile } from "./fileio.js";

export interface ProjectContextDecision {
  decision: string;
  reason: string;
  recordedAt: string;
}

export interface ProjectProfile {
  architecture: string;
  conventions: string[];
  commands: Record<string, string>;
  designRules: string[];
  constraints: string[];
  knownRisks: string[];
  decisions: ProjectContextDecision[];
}

export interface ProjectContext {
  schemaVersion: "1.0";
  updatedAt: string;
  profile: ProjectProfile;
  /** sha256 fingerprints of key files at last update, used for staleness detection. */
  fingerprints: Record<string, string>;
  history: Array<{ at: string; change: string }>;
}

export interface ContextFreshness {
  fresh: boolean;
  staleFiles: string[];
  missing: boolean;
}

const CONTEXT_DIR = ".promptpilot";
const CONTEXT_FILE = "context.json";

const FINGERPRINT_FILES = [
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
];

function contextPath(root: string): string {
  return path.join(path.resolve(root), CONTEXT_DIR, CONTEXT_FILE);
}

function hashFile(file: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

function collectFingerprints(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of FINGERPRINT_FILES) {
    const h = hashFile(path.join(root, rel));
    if (h) out[rel] = h;
  }
  return out;
}

export function emptyProfile(): ProjectProfile {
  return {
    architecture: "",
    conventions: [],
    commands: {},
    designRules: [],
    constraints: [],
    knownRisks: [],
    decisions: [],
  };
}

export function getProjectContext(root: string): { context: ProjectContext | null; freshness: ContextFreshness } {
  const file = contextPath(root);
  if (!fs.existsSync(file)) {
    return {
      context: null,
      freshness: { fresh: false, missing: true, staleFiles: [] },
    };
  }
  const context = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectContext;
  const current = collectFingerprints(root);
  const staleFiles = Object.entries(current)
    .filter(([rel, hash]) => context.fingerprints[rel] !== hash)
    .map(([rel]) => rel);
  return {
    context,
    freshness: { fresh: staleFiles.length === 0, staleFiles, missing: false },
  };
}

export interface UpdateContextPatch {
  architecture?: string;
  conventions?: string[];
  commands?: Record<string, string>;
  designRules?: string[];
  constraints?: string[];
  knownRisks?: string[];
  decision?: ProjectContextDecision;
  changeNote?: string;
  removeDecisionIndex?: number;
}

/** Merge verified facts into the persistent project profile and refresh fingerprints. */
export function updateProjectContext(root: string, patch: UpdateContextPatch): ProjectContext {
  const { context } = getProjectContext(root);
  const next: ProjectContext = context ?? {
    schemaVersion: "1.0",
    updatedAt: new Date().toISOString(),
    profile: emptyProfile(),
    fingerprints: {},
    history: [],
  };

  const p = next.profile;
  if (patch.architecture !== undefined) p.architecture = patch.architecture;
  const mergeList = (target: string[], add?: string[]) => {
    for (const item of add ?? []) if (!target.includes(item)) target.push(item);
  };
  mergeList(p.conventions, patch.conventions);
  mergeList(p.designRules, patch.designRules);
  mergeList(p.constraints, patch.constraints);
  mergeList(p.knownRisks, patch.knownRisks);
  Object.assign(p.commands, patch.commands ?? {});
  if (patch.decision) p.decisions.push(patch.decision);
  if (patch.removeDecisionIndex !== undefined && p.decisions[patch.removeDecisionIndex]) {
    p.decisions.splice(patch.removeDecisionIndex, 1);
  }

  next.updatedAt = new Date().toISOString();
  next.fingerprints = collectFingerprints(root);
  next.history.push({ at: next.updatedAt, change: patch.changeNote ?? "context updated" });
  if (next.history.length > 50) next.history = next.history.slice(-50);

  const file = contextPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Read a repo file safely (bounded size) for context tooling. */
export function readProjectFile(root: string, relPath: string, maxChars = 20_000): string | null {
  return readTextFile(path.join(root, relPath), maxChars);
}
