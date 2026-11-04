import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import dotenv from "dotenv";
import { select, input, password } from "@inquirer/prompts";                                        import { AskGptConfig, ProviderType } from "./types.js";

// Load .env: current folder first, then the global one (dotenv never overrides, so first wins)
export const CONFIG_FILE = "config.json";
export const GLOBAL_CONFIG_DIR =
  process.env.TERRIBLE_HARNESS_HOME ?? path.join(os.homedir(), ".terrible-harness");
export const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "config.json");
const GLOBAL_ENV_FILE = path.join(GLOBAL_CONFIG_DIR, ".env");
const LEGACY_CONFIG_FILE = path.join(os.homedir(), ".askgpt", "config.json");

dotenv.config({ quiet: true });
dotenv.config({ path: GLOBAL_ENV_FILE, quiet: true });

export const DEFAULT_MODELS: Record<ProviderType, string> = {
  groq: "openai/gpt-oss-120b",
  openai: "gpt-4o",
  google: "gemini-3.5-flash-lite",
  anthropic: "claude-3-7-sonnet-20250219",
  ollama: "llama3.2",
  custom: "custom-model"
};

// The file the active configuration was loaded from (used by /edit to know where to save).
let loadedConfigFile: string | null = null;
export function getLoadedConfigFile(): string | null {
  return loadedConfigFile;
}
export function setLoadedConfigFile(file: string | null): void {
  loadedConfigFile = file;
}

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
    if (process.env.GEMINI_API_KEY) {
      return {
        provider: "google",
        model: process.env.MODEL || DEFAULT_MODELS.google,
        apiKey: process.env.GEMINI_API_KEY
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

    loadedConfigFile = configFile;
    return parsed;
  } catch (err: any) {
    console.error(chalk.red(`Failed to parse config file ${configFile}: ${err.message}`));
    return null;
  }
}

/** Reads a config file exactly as written (no environment overrides). Throws on invalid JSON. */
export function readRawConfig(file: string): AskGptConfig {
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the file does not contain a JSON object");
  }
  return parsed as AskGptConfig;
}

/** Writes a config file without printing anything. Owner-only permissions, since it may hold API keys. */
export function writeConfigFile(file: string, config: AskGptConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
}

/** Config files you can switch to: config*.json in the global folder and in the current folder. */
export function listConfigFiles(): string[] {
  const found = new Set<string>();
  for (const dir of [GLOBAL_CONFIG_DIR, process.cwd()]) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!/^config.*\.json$/.test(name)) continue;
        const full = path.join(dir, name);
        try {
          const raw = readRawConfig(full);
          if (typeof raw.provider === "string") found.add(full);
        } catch {
          // not a usable config file
        }
      }
    } catch {
      // folder doesn't exist
    }
  }
  return [...found];
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

export interface ProviderSettings {
  apiKey?: string;
  baseURL?: string;
  model: string;
  custom?: AskGptConfig["custom"];
}

export const PROVIDER_CHOICES: { name: string; value: ProviderType }[] = [
  { name: "Groq (Fast, supports DeepSeek R1, Llama 3.3, tool calling)", value: "groq" },
  { name: "OpenAI (GPT-4o, o3-mini)", value: "openai" },
  { name: "Google (Literal lightning)", value: "google" },
  { name: "Anthropic (Claude 3.7 Sonnet)", value: "anthropic" },
  { name: "Ollama / llama.cpp (Local OpenAI-compatible API)", value: "ollama" },
  { name: "Custom JSON API (Custom endpoint & payload template)", value: "custom" }
];

/**
 * The per-provider questions (API key, base URL, model). Used by the first-run
 * wizard and by /edit cfg. With `current`, answers default to the current values
 * and an empty API key keeps the existing one.
 */
export async function promptProviderSettings(
  provider: ProviderType,
  current?: Partial<AskGptConfig>
): Promise<ProviderSettings> {
  let apiKey: string | undefined = current?.apiKey;
  let baseURL: string | undefined = current?.baseURL;
  let model: string = current?.model || DEFAULT_MODELS[provider] || "gpt-4o";
  let custom = current?.custom;

  const askKey = async (message: string): Promise<void> => {
    const entered = await password({
      message: current?.apiKey ? `${message} (leave empty to keep the current one)` : message,
      mask: "*"
    });
    if (entered) apiKey = entered;
  };

  if (provider === "groq") {
    await askKey("Enter your Groq API Key (get one at console.groq.com):");
    model = await input({ message: "Enter model name:", default: model });
  } else if (provider === "openai") {
    await askKey("Enter your OpenAI API Key:");
    model = await input({ message: "Enter model name:", default: model });
  } else if (provider === "anthropic") {
    await askKey("Enter your Anthropic API Key:");
    model = await input({ message: "Enter model name:", default: model });
  } else if (provider === "ollama") {
    baseURL = await input({
      message: "Enter API Base URL:",
      default: current?.baseURL || "http://localhost:11434/v1"
    });
    apiKey =
      (await input({
        message: "Enter API Key (optional for local):",
        default: current?.apiKey || "ollama"
      })) || "ollama";
    model = await input({ message: "Enter model name:", default: model });
  } else if (provider === "google") {
    await askKey("Enter your Gemini API Key (from AI Studio):");
    model = await input({ message: "Enter model name:", default: model });
  } else if (provider === "custom") {
    const url = await input({
      message: "Enter custom endpoint URL:",
      default: current?.custom?.url || "http://127.0.0.1:8080/completion"
    });
    const method = await input({
      message: "HTTP Method:",
      default: current?.custom?.method || "POST"
    });
    const responsePath = await input({
      message: "JSON path to extract response text (e.g. content or choices[0].text):",
      default: current?.custom?.responsePath || "content"
    });
    model = await input({
      message: "Model identifier:",
      default: current?.model || "custom"
    });
    custom = {
      url,
      method,
      headers: current?.custom?.headers ?? { "Content-Type": "application/json" },
      payloadTemplate: current?.custom?.payloadTemplate ?? {
        prompt: "{{prompt}}",
        messages: "{{messages}}",
        temperature: 0.7
      },
      responsePath
    };
  }

  return { apiKey, baseURL, model, custom };
}

export async function runConfigWizard(
  options: { destination?: string; intro?: boolean } = {}
): Promise<AskGptConfig> {
  if (options.intro !== false) {
    console.log(chalk.bold.cyan("\n First time? Well...\n"));
    console.log(chalk.gray("No config.json found. Let's configure your LLM provider.\n"));
  }

  const provider = (await select({
    message: "Select your LLM Provider:",
    choices: PROVIDER_CHOICES
  })) as ProviderType;

  const settings = await promptProviderSettings(provider);

  const newConfig: AskGptConfig = {
    provider,
    model: settings.model,
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    thinking: {
      defaultVisible: false
    },
    custom: settings.custom
  };

  saveConfig(newConfig, options.destination); // default: the global config.json
  loadedConfigFile = path.resolve(process.cwd(), options.destination ?? GLOBAL_CONFIG_FILE);
  return newConfig;
}
