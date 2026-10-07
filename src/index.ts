import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, runConfigWizard } from "./config.js";
import { loadContext, saveContext, clearContext, loadSystemPrompt } from "./context.js";
import { ReasoningManager } from "./reasoning.js";
import { streamChatResponse } from "./providers/ai-sdk.js";
import { executeCustomApi } from "./providers/custom.js";
import { startRepl } from "./repl.js";
import { AskGptConfig, ChatMessage, ProviderType } from "./types.js";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim());
    });
    process.stdin.on("error", () => {
      resolve("");
    });
  });
}

async function main() {
  const program = new Command();

  program
    .name("askgpt")
    .description("Terminal chat assistant connecting to any LLM API with context, thinking, and tools")
    .version("1.0.0")
    .argument("[prompt...]", "Prompt to ask the model (runs in one-shot mode)")
    .option("-p, --provider <provider>", "LLM provider (groq, openai, anthropic, ollama, custom)")
    .option("-m, --model <model>", "Model name")
    .option("-c, --config <path>", "Path to config.json")
    .option("--stateless", "Do not read or save conversation to .context.json")
    .option("--think", "Show thinking process in real-time")
    .option("--yolo", "Auto-approve all tool executions without prompting")
    .option("--clear", "Clear conversation history in .context.json and exit")
    .helpOption("-h, --help", "Display help information");

  program.parse(process.argv);

  const options = program.opts();
  const promptArgs = program.args;

  // Handle --clear flag
  if (options.clear) {
    clearContext();
    console.log(chalk.green("Cleared conversation context in .context.json."));
    process.exit(0);
  }

  // Load configuration
  let config = loadConfig(options.config);

  // If no config found and in interactive terminal, run setup wizard
  if (!config) {
    if (process.stdin.isTTY) {
      config = await runConfigWizard();
    } else {
      console.error(chalk.red("Error: No config.json found and required environment variables are not set."));
      console.error(chalk.yellow("Please run 'askgpt' in an interactive terminal to configure, or set GROQ_API_KEY / OPENAI_API_KEY."));
      process.exit(1);
    }
  }

  // Apply CLI overrides
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
    if (!config.thinking) config.thinking = {};
    config.thinking.defaultVisible = true;
  }

  // Read stdin if piped
  const stdinContent = await readStdin();

  let finalPrompt = "";
  if (stdinContent && promptArgs.length > 0) {
    finalPrompt = `${promptArgs.join(" ")}\n\n[Piped Input]:\n${stdinContent}`;
  } else if (stdinContent) {
    finalPrompt = stdinContent;
  } else if (promptArgs.length > 0) {
    finalPrompt = promptArgs.join(" ");
  }

  // If no prompt and no piped input, start interactive REPL
  if (!finalPrompt) {
    await startRepl(config);
    return;
  }

  // One-shot execution
  const isStateless = Boolean(options.stateless);
  const context: ChatMessage[] = isStateless ? [] : loadContext();
  const systemPrompt = loadSystemPrompt();

  context.push({ role: "user", content: finalPrompt });
  if (!isStateless) {
    saveContext(context);
  }

  const thinkingVisible = Boolean(options.think || config.thinking?.defaultVisible);
  const reasoningManager = new ReasoningManager(thinkingVisible, config.model);

  try {
    let assistantText = "";
    if (config.provider === "custom") {
      assistantText = await executeCustomApi(
        config,
        context,
        systemPrompt,
        reasoningManager,
        (chunk) => {
          process.stdout.write(chunk);
        }
      );
    } else {
      assistantText = await streamChatResponse({
        config,
        messages: context,
        systemPrompt,
        reasoningManager,
        enableTools: true,
        onContentChunk: (chunk) => {
          process.stdout.write(chunk);
        }
      });
    }

    process.stdout.write("\n");

    if (!isStateless && assistantText.trim()) {
      context.push({ role: "assistant", content: assistantText });
      saveContext(context);
    }
  } catch (err: any) {
    console.error(chalk.red(`\nError: ${err.message}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
