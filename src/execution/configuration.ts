import chalk from "chalk";
import {
  loadConfig,
  saveConfig,
  runConfigWizard,
} from "../config.js";
import type { AskGptConfig, ProviderType } from "../types.js";

export interface ConfigOptions {
  config?: string;
  aiComment?: string;
  provider?: string;
  model?: string;
  yolo?: boolean;
  think?: boolean;
}

export async function initializeConfig(
  options: ConfigOptions,
): Promise<AskGptConfig> {
  let config = loadConfig(options.config);

  if (!config) {
    if (process.stdin.isTTY) {
      config = await runConfigWizard();
    } else {
      console.error(
        chalk.red("Nah you havent created .config.json?? THERE'S NO ENVIORNMENT OVERRIDE??"),
      );
      console.error(
        chalk.yellow("Just run npx terrible-harness already or set your keys in .env :wilted_rose:"),
      );
      process.exit(1);
    }
  }

  if (options.aiComment !== undefined) {
    config.aiComment = options.aiComment === "true";
    saveConfig(config);
  }

  if (options.provider) {
    config.provider = options.provider as ProviderType;
  }

  if (options.model) {
    config.model = options.model;
  }

  if (options.yolo) {
    config.autoApproveTools = true;
  }

  if (options.think) {
    if (!config.thinking) {
      config.thinking = {};
    }
    config.thinking.defaultVisible = true;
  }

  return config;
}
