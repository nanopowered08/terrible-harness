import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import dotenv from "dotenv";
import { select, input, password } from "@inquirer/prompts";                                        import { AskGptConfig, ProviderType } from "./types.js";

// Load .env: current folder first, then the global one (dotenv never overrides, so first wins)     export const CONFIG_FILE = "config.json";
export const GLOBAL_CONFIG_DIR =
  process.env.TERRIBLE_HARNESS_HOME ?? path.join(os.homedir(), ".terrible-harness");
export const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "config.json");
const GLOBAL_ENV_FILE = path.join(GLOBAL_CONFIG_DIR, ".env");
const LEGACY_CONFIG_FILE = path.join(os.homedir(), ".askgpt", "config.json");

dotenv.config({ quiet: true })
dotenv.config();
dotenv.config({ path: GLOBAL_ENV_FILE });

export const DEFAULT_MODELS: Record<ProviderType, string> = {
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o",
  anthropic: "claude-3-7-sonnet-20250219",
  ollama: "llama3.2",
  custom: "custom-model"
};

export function findConfigFile(customPath?: string): string | null {
  if (customPath) {
    const resolved = path.resolve(process.cwd(), customPath);
    if (fs.existsSync(resolved)) return resolved;
  }
  const local = path.resolve(process.cwd(), CONFIG_FILE);
  if (fs.existsSync(GLOBAL_CONFIG_FILE)) return GLOBAL_CONFIG_FILE;
  if (fs.existsSync(LEGACY_CONFIG_FILE)) return LEGACY_CONFIG_FILE;
  return null;
}

export function loadConfig(customPath?: string): AskGptConfig | null {
  const configFile = findConfigFile(customPath);
  if (!configFile) {
    // Check if environment variables are available
    if (process.env.GROQ_API_KEY) {
      return {
        provider: "groq",
        model: process.env.MODEL || DEFAULT_MODELS.groq,
        apiKey: process.env.GROQ_API_KEY
      };
    }
    if (process.env.OPENAI_API_KEY) {
      return {
        provider: "openai",
        model: process.env.MODEL || DEFAULT_MODELS.openai,
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL
      };
    }
    if (process.env.ANTHROPIC_API_KEY) {
      return {
        provider: "anthropic",
        model: process.env.MODEL || DEFAULT_MODELS.anthropic,
        apiKey: process.env.ANTHROPIC_API_KEY
      };
    }
    return null;
  }

  try {
    const raw = fs.readFileSync(configFile, "utf-8");
    const parsed: AskGptConfig = JSON.parse(raw);

    // Allow environment variable overrides
    if (parsed.provider === "groq" && process.env.GROQ_API_KEY) {
      parsed.apiKey = process.env.GROQ_API_KEY;
    } else if (parsed.provider === "openai" && process.env.OPENAI_API_KEY) {
      parsed.apiKey = process.env.OPENAI_API_KEY;
    } else if (parsed.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      parsed.apiKey = process.env.ANTHROPIC_API_KEY;
    }
    if (process.env.MODEL) {
      parsed.model = process.env.MODEL;
    }

    return parsed;
  } catch (err: any) {
    console.error(chalk.red(`Failed to parse config file ${configFile}: ${err.message}`));
    return null;
  }
}

export function saveConfig(config: AskGptConfig, destination: string = GLOBAL_CONFIG_FILE): void {
  try {
    const fullPath = path.resolve(process.cwd(), destination);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
    console.log(chalk.green(`Configuration saved to ${fullPath}`));
  } catch (err: any) {
    console.error(chalk.red(`Could not save config to ${destination}: ${err.message}`));
  }
}

export async function runConfigWizard(): Promise<AskGptConfig> {
  console.log(chalk.bold.cyan("\n Welcome to askgpt Setup Wizard!\n"));
  console.log(chalk.gray("No config.json found. Let's configure your LLM provider.\n"));

  const provider = (await select({
    message: "Select your LLM Provider:",
    choices: [
      { name: "Groq (Fast, supports DeepSeek R1, Llama 3.3, tool calling)", value: "groq" },
      { name: "OpenAI (GPT-4o, o3-mini)", value: "openai" },
      { name: "Anthropic (Claude 3.7 Sonnet)", value: "anthropic" },
      { name: "Ollama / llama.cpp (Local OpenAI-compatible API)", value: "ollama" },
      { name: "Custom JSON API (Custom endpoint & payload template)", value: "custom" }
    ]
  })) as ProviderType;

  let apiKey: string | undefined;
  let baseURL: string | undefined;
  let model: string = DEFAULT_MODELS[provider] || "gpt-4o";

  if (provider === "groq") {
    apiKey = await password({
      message: "Enter your Groq API Key (get one at console.groq.com):",
      mask: "*"
    });
    model = await input({
      message: "Enter model name:",
      default: DEFAULT_MODELS.groq
    });
  } else if (provider === "openai") {
    apiKey = await password({
      message: "Enter your OpenAI API Key:",
      mask: "*"
    });
    model = await input({
      message: "Enter model name:",
      default: DEFAULT_MODELS.openai
    });
  } else if (provider === "anthropic") {
    apiKey = await password({
      message: "Enter your Anthropic API Key:",
      mask: "*"
    });
    model = await input({
      message: "Enter model name:",
      default: DEFAULT_MODELS.anthropic
    });
  } else if (provider === "ollama") {
    baseURL = await input({
      message: "Enter API Base URL:",
      default: "http://localhost:11434/v1"
    });
    apiKey = (await input({
      message: "Enter API Key (optional for local):",
      default: "ollama"
    })) || "ollama";
    model = await input({
      message: "Enter model name:",
      default: DEFAULT_MODELS.ollama
    });
  }

  let customConfig = undefined;
  if (provider === "custom") {
    const url = await input({
      message: "Enter custom endpoint URL:",
      default: "http://127.0.0.1:8080/completion"
    });
    const method = await input({
      message: "HTTP Method:",
      default: "POST"
    });
    const responsePath = await input({
      message: "JSON path to extract response text (e.g. content or choices[0].text):",
      default: "content"
    });
    model = await input({
      message: "Model identifier:",
      default: "custom"
    });
    customConfig = {
      url,
      method,
      headers: { "Content-Type": "application/json" },
      payloadTemplate: {
        prompt: "{{prompt}}",
        messages: "{{messages}}",
        temperature: 0.7
      },
      responsePath
    };
  }

  const newConfig: AskGptConfig = {
    provider,
    model,
    apiKey,
    baseURL,
    thinking: {
      defaultVisible: false
    },
    custom: customConfig
  };

  saveConfig(newConfig); // goes to the global dir now
  return newConfig;
}
