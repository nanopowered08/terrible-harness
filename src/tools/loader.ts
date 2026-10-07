import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import chalk from "chalk";
import { ToolDefinition } from "../types.js";

export async function loadCustomTools(toolsDir: string = "tools"): Promise<ToolDefinition[]> {
  const fullPath = path.resolve(process.cwd(), toolsDir);
  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const customTools: ToolDefinition[] = [];
  try {
    const files = fs.readdirSync(fullPath);
    for (const file of files) {
      if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".ts")) {
        const filePath = path.join(fullPath, file);
        try {
          const fileUrl = pathToFileURL(filePath).href;
          const imported = await import(fileUrl);
          const toolObj = imported.default || imported;

          if (toolObj && toolObj.name && toolObj.description && typeof toolObj.execute === "function") {
            customTools.push({
              name: toolObj.name,
              description: toolObj.description,
              parameters: toolObj.parameters,
              execute: toolObj.execute
            });
          }
        } catch (err: any) {
          console.error(chalk.yellow(`Warning: Failed to load custom tool from ${file}: ${err.message}`));
        }
      }
    }
  } catch (err: any) {
    console.error(chalk.yellow(`Warning: Could not read tools directory: ${err.message}`));
  }

  return customTools;
}
