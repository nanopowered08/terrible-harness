
import chalk from "chalk";
import { clearContext, loadSystemPrompt } from "../context.js";
import { generateAiComment } from "../ai-comment.js";
import { loadConfig, saveConfig } from "../config.js";

export interface ClearOptions {
  clear?: boolean;
  config?: string;
  aiComment?: string;
}

export async function executeClear(options: ClearOptions): Promise<void> {
  let status = 0;

  try {
    clearContext();
    console.log(
      chalk.green("D- Done... but you could've just rm -f .context.json!!"),
    );
  } catch (err) {
    status = 1;
    console.error(chalk.red("Failed to clear context:"), err);
  }

  try {
    const config = loadConfig(options.config);

    if (options.aiComment !== undefined && config) {
      config.aiComment = options.aiComment === "true";
      saveConfig(config);
    }

    if (options.aiComment === "true" || config?.aiComment) {
      const systemPrompt =
        loadSystemPrompt() ||
        "You are an assistant whose only sole purpose is to generate a comment for a flag the user executed";

      const comment = await generateAiComment(
        config,
        systemPrompt,
        "--clear",
        "--clear",
        status,
      );

      console.error(chalk.magenta(`💬 ${comment}`));
    }
  } catch {
    console.error(
      chalk.magenta("💬 The commentator vanished into the void. 💀"),
    );
  }

  process.exit(status);
}
