// src/tools/mcp.ts
// MCP (Model Context Protocol) client support: connects to the servers listed
// under "mcpServers" in config.json (stdio or HTTP/SSE), discovers their tools
// once per run, and exposes them next to the built-in tools.
//
//   "mcpServers": {
//     "studio": { "command": "path/to/studio-mcp", "args": ["--stdio"] },
//     "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${TOKEN}" } }
//   }
//
// Every MCP call asks for approval (like commands and file writes) unless
// --yolo is on or that server has "autoApprove": true.

import chalk from "chalk";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { confirmTool, rejectionMessage } from "./confirm.js";
import type { McpServerConfig } from "../types.js";

const CONNECT_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 3_000;
const MAX_RESULT_CHARS = 20_000; // keep one huge tool result from eating the context window
const MAX_PREVIEW_CHARS = 1_500;

export interface McpToolInfo {
  name: string;        // name the model sees, e.g. studio__run_code
  server: string;
  remoteName: string;  // name on the server
  description: string;
}

export interface McpLoadResult {
  tools: Record<string, any>;
  info: McpToolInfo[];
  errors: { server: string; message: string }[];
}

const EMPTY: McpLoadResult = { tools: {}, info: [], errors: [] };

// Connections are cached per run. Approval is applied when the tools are
// wrapped (every getTools call), so --yolo / per-server autoApprove never
// forces a reconnect.
interface RawMcpTool {
  name: string;
  server: string;
  remoteName: string;
  cfg: McpServerConfig;
  tool: any;
}
interface Loaded {
  raw: RawMcpTool[];
  errors: { server: string; message: string }[];
}

let cache: { key: string; loaded: Promise<Loaded> } | null = null;
const openClients: { server: string; close: () => Promise<void> }[] = [];

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_m, name) => process.env[name] ?? "");
}

function expandRecord(rec?: Record<string, string>): Record<string, string> | undefined {
  if (!rec) return undefined;
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, expandEnv(String(v))]));
}

function safeName(server: string, tool: string, taken: Set<string>): string {
  let base = `${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!/^[a-zA-Z_]/.test(base)) base = `_${base}`;
  base = base.slice(0, 64); // function-name limit on several providers
  let name = base;
  for (let n = 2; taken.has(name); n++) {
    const suffix = `_${n}`;
    name = base.slice(0, 64 - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function pretty(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}\n... (cut)` : text;
}

/** Cuts oversized text in an MCP result ({ content: [{ type: "text", text }] }). */
function capResult(result: any): any {
  if (!result || !Array.isArray(result.content)) return result;
  let budget = MAX_RESULT_CHARS;
  let cut = 0;
  const content = result.content.map((part: any) => {
    if (part?.type !== "text" || typeof part.text !== "string") return part;
    if (part.text.length <= budget) {
      budget -= part.text.length;
      return part;
    }
    cut += part.text.length - budget;
    const kept = part.text.slice(0, Math.max(budget, 0));
    budget = 0;
    return { ...part, text: `${kept}\n[truncated ${cut} more characters]` };
  });
  return { ...result, content };
}

async function connectServer(name: string, cfg: McpServerConfig): Promise<any> {
  let transport: any;

  if (cfg.command) {
    transport = new StdioMCPTransport({
      command: expandEnv(cfg.command),
      args: cfg.args?.map(expandEnv),
      env: expandRecord(cfg.env),
      cwd: cfg.cwd,
      stderr: cfg.stderr === "inherit" ? "inherit" : "ignore"
    });
  } else if (cfg.url) {
    const url = expandEnv(cfg.url);
    transport = {
      type: cfg.type ?? (/\/sse\/?$/.test(url) ? "sse" : "http"),
      url,
      headers: expandRecord(cfg.headers)
    };
  } else {
    throw new Error('needs either "command" (stdio) or "url" (http/sse)');
  }

  return withTimeout(createMCPClient({ transport }), CONNECT_TIMEOUT_MS, "connecting");
}

async function connectAll(servers: Record<string, McpServerConfig>): Promise<Loaded> {
  const loaded: Loaded = { raw: [], errors: [] };
  const taken = new Set<string>();
  const entries = Object.entries(servers).filter(([, cfg]) => cfg && !cfg.disabled);

  const settled = await Promise.all(
    entries.map(async ([server, cfg]) => {
      try {
        const client = await connectServer(server, cfg);
        openClients.push({ server, close: () => client.close() });
        const toolSet: Record<string, any> = await withTimeout<any>(client.tools(), CONNECT_TIMEOUT_MS, "listing tools");
        return { server, cfg, toolSet };
      } catch (err: any) {
        const message = err?.message ?? String(err);
        console.error(chalk.yellow(`[MCP] ${server}: failed to connect (${message})`));
        loaded.errors.push({ server, message });
        return null;
      }
    })
  );

  // Keep tool order stable: config order, then the order each server lists them.
  for (const item of settled) {
    if (!item) continue;
    for (const [remoteName, tool] of Object.entries<any>(item.toolSet)) {
      if (typeof tool?.execute !== "function") continue;
      loaded.raw.push({
        name: safeName(item.server, remoteName, taken),
        server: item.server,
        remoteName,
        cfg: item.cfg,
        tool
      });
    }
  }
  return loaded;
}

function wrapTools(loaded: Loaded, autoApproveAll: boolean): McpLoadResult {
  const result: McpLoadResult = { tools: {}, info: [], errors: loaded.errors };

  for (const { name, server, remoteName, cfg, tool: t } of loaded.raw) {
    const skipApproval = autoApproveAll || cfg.autoApprove === true;
    const description = `[MCP: ${server}] ${t.description ?? remoteName}`;

    result.tools[name] = {
      ...t,
      description,
      execute: async (args: any, execOptions: any) => {
        const verdict = await confirmTool({
          question: `Run MCP tool ${server}/${remoteName}?`,
          autoApprove: skipApproval,
          preview: () => {
            console.log(chalk.cyan(`[MCP ${server}] ${remoteName}`));
            console.log(chalk.gray(pretty(args)));
          }
        });
        if (!verdict.approved) {
          return { success: false, rejected: true, error: rejectionMessage(verdict, "MCP tool call") };
        }
        if (skipApproval) {
          const oneLine = JSON.stringify(args ?? {});
          console.log(chalk.cyan(`\n[MCP ${server}] ${remoteName} ${oneLine.length > 120 ? oneLine.slice(0, 120) + "..." : oneLine}`));
        }
        return capResult(await t.execute(args, execOptions));
      }
    };
    result.info.push({ name, server, remoteName, description });
  }

  return result;
}

/** Connects once per run (cached) and returns the MCP tools. Never throws. */
export async function loadMcpTools(
  servers: Record<string, McpServerConfig> | undefined,
  autoApprove = false
): Promise<McpLoadResult> {
  if (!servers || Object.keys(servers).length === 0) return EMPTY;

  const key = JSON.stringify(servers);
  if (!cache || cache.key !== key) {
    cache = { key, loaded: connectAll(servers).catch(() => ({ raw: [], errors: [] })) };
  }
  return wrapTools(await cache.loaded, autoApprove);
}

/** Shuts down every MCP connection (and the stdio child processes). Safe to call twice. */
export async function closeMcpClients(): Promise<void> {
  const clients = openClients.splice(0);
  cache = null;
  await Promise.all(
    clients.map((c) =>
      withTimeout(c.close(), CLOSE_TIMEOUT_MS, "closing").catch(() => {})
    )
  );
}
