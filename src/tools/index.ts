import { tool, jsonSchema } from "ai";
import chalk from "chalk";
import { executeBash } from "./bash.js";
import { readFile, writeFile } from "./files.js";
import { searchWeb } from "./search.js";
import { loadCustomTools } from "./loader.js";

export interface ToolRegistryOptions {
  autoApprove?: boolean;
  provider?: string;
  lastUserPrompt?: string;
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
          stderr: result.stderr
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
      description: "Write content to a file at the specified path. Creates any missing parent directories.",
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
        return writeFile(filePath, content, Boolean(args?.append));
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
    })
  };

  // Load custom tools
  const customTools = await loadCustomTools();
  for (const custom of customTools) {
    if (custom.parameters && typeof custom.parameters === "object") {
      tools[custom.name] = tool({
        description: custom.description,
        parameters: custom.parameters,
        execute: custom.execute
      });
    }
  }

  return tools;
}
