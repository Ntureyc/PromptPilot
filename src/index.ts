#!/usr/bin/env node
/**
 * PromptPilot — MCP server that turns vague prompts into context-rich,
 * bounded, verifiable engineering tasks for coding agents.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

const VERSION = "1.0.0";

function resolveRoot(): string {
  const idx = process.argv.indexOf("--root");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.PROMPTPILOT_ROOT ?? process.cwd();
}

export function createServer(root = resolveRoot()): McpServer {
  const server = new McpServer({ name: "PromptPilot", version: VERSION });
  registerTools(server, root);
  registerResources(server, root);
  registerPrompts(server);
  return server;
}

async function main(): Promise<void> {
  const root = resolveRoot();
  const server = createServer(root);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is reserved for the MCP protocol.
  console.error(`PromptPilot v${VERSION} (MCP stdio) — project root: ${root}`);
}

// Only auto-start when executed as a binary (keeps createServer importable for tests).
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("promptpilot"));

if (invokedDirectly) {
  main().catch((err) => {
    console.error("PromptPilot failed to start:", err);
    process.exit(1);
  });
}
