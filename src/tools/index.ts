import { tool, jsonSchema } from "ai";
import chalk from "chalk";
import { executeBash } from "./bash.js";
import { readFile } from "./files.js";
import { guardedWrite } from "./WriteGuard.js";
import { searchWeb } from "./search.js";
import { loadCustomTools } from "./loader.js";
import { openWebpage } from "./open_webpage.js";
import { loadMcpTools } from "./mcp.js";
import type { McpServerConfig } from "../types.js";

export interface ToolRegistryOptions {
  autoApprove?: boolean;
  provider?: string;
  lastUserPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
}

/** Where each tool came from, for the banner and /tools. Rebuilt on every getTools() call. */
export type ToolOrigin = { kind: "built-in" | "custom" | "mcp"; server?: string };
let toolOrigins = new Map<string, ToolOrigin>();
export function getToolOrigins(): Map<string, ToolOrigin> {
  return toolOrigins;
}

export async function getTools(options: ToolRegistryOptions = {}): Promise<Record<string, any>> {
  const tools: Record<string, any> = {
    execute_command: tool({
      description: "Execute a shell command on the local system (with user confirmation). Use this to run scripts, build projects, or inspect system state.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The exact shell command line to execute"
          },
          explanation: {
            type: "string",
            description: "Brief explanation of what the command does"
          }
        },
        required: ["command"]
      }),
      execute: async (args: any) => {
        const command = args?.command || args?.cmd || args?.script || "";
        const explanation = args?.explanation || args?.reason || "";
        const result = await executeBash(command, explanation, { autoApprove: options.autoApprove });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(result.rejected ? { rejected: true } : {})
        };
      }
    }),

    read_file: tool({
      description: "Read the contents of a local file at the specified path.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "The relative or absolute file path to read"
          },
          startLine: {
            type: "number",
            description: "Starting line number (1-indexed)"
          },
          endLine: {
            type: "number",
            description: "Ending line number (1-indexed)"
          }
        },
        required: ["filePath"]
      }),
      execute: async (args: any) => {
        const filePath = args?.filePath || args?.path || args?.file || "";
        return readFile(filePath, args?.startLine, args?.endLine);
      }
    }),

    write_file: tool({
      description: "Write content to a file at the specified path. Creates any missing parent directories. You must read_file an existing file before overwriting it. The user sees a diff and may reject the change (with a reason); if rejected, adjust your approach instead of retrying unchanged.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "The relative or absolute file path to write"
          },
          content: {
            type: "string",
            description: "The exact content to write to the file"
          },
          append: {
            type: "boolean",
            description: "Set to true to append to existing file content instead of overwriting"
          }
        },
        required: ["filePath", "content"]
      }),
      execute: async (args: any) => {
        const filePath = args?.filePath || args?.path || args?.file || "";
        const content = args?.content || "";
        return guardedWrite(filePath, content, Boolean(args?.append), {
          autoApprove: options.autoApprove
        });
      }
    }),

    search_web: tool({
      description: "Search the web for up-to-date information, documentation, news, or answers.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query string to search for"
          }
        },
        required: ["query"]
      }),
      execute: async (args: any) => {
        let query = args?.query || args?.q || args?.search_query || args?.keyword || args?.input;
        if (!query || typeof query !== "string") {
          query = options.lastUserPrompt || "information";
        }
        console.log(chalk.cyan(`\n[Web Search]: ${query}`));
        const results = await searchWeb(query);
        return { query, results };
      }
    }),

    open_webpage: tool({
      description:
        "Open a webpage by URL and extract its readable text. Use after search_web to read documentation, inspect sources, and verify information.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The complete HTTP or HTTPS URL to open"
          }
        },
        required: ["url"]
      }),
      execute: async (args: any) => {
        const url = args?.url || args?.uri || args?.link;

        if (typeof url !== "string" || !url.trim()) {
          throw new Error("A valid webpage URL is required.");
        }

        console.log(chalk.cyan(`\n[Open Webpage]: ${url}`));

        return await openWebpage(url);
      }
    })
  };

  const origins = new Map<string, ToolOrigin>();
  for (const name of Object.keys(tools)) origins.set(name, { kind: "built-in" });

  // Load custom tools
  const customTools = await loadCustomTools();
  for (const custom of customTools) {
    if (custom.parameters && typeof custom.parameters === "object") {
      tools[custom.name] = tool({
        description: custom.description,
        inputSchema: jsonSchema<Record<string, unknown>>(
          custom.parameters
        ),
        execute: async (args: Record<string, unknown>) =>
          custom.execute(args)
      });
    }
  }

  for (const custom of customTools) {
    if (tools[custom.name] && !origins.has(custom.name)) origins.set(custom.name, { kind: "custom" });
  }

  // MCP tools (connected once per run; built-in and custom names win on a clash)
  const mcp = await loadMcpTools(options.mcpServers, Boolean(options.autoApprove));
  for (const info of mcp.info) {
    if (tools[info.name]) continue;
    tools[info.name] = mcp.tools[info.name];
    origins.set(info.name, { kind: "mcp", server: info.server });
  }

  toolOrigins = origins;
  return tools;
}
