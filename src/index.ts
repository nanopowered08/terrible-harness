import { Command } from "commander"; import chalk from "chalk";           import { loadConfig, runConfigWizard } from "./config.js";                import { loadContext, saveContext, clearContext, loadSystemPrompt } from "./context.js";                       import { ReasoningManager } from "./reasoning.js";                        import { streamChatResponse } from "./providers/ai-sdk.js";               import { executeCustomApi } from "./providers/custom.js";                 import { startRepl } from "./repl.js";                                    import { AskGptConfig, ChatMessage, ProviderType } from "./types.js";
async function readStdin(): Promise<Buffer> {
  if (process.stdin.isTTY) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  try {                                               for await (const c of process.stdin) chunks.push(c as Buffer);                                    } catch {}
  return Buffer.concat(chunks);
}
(globalThis as any).AI_SDK_LOG_WARNINGS = false;

// staging: REPL images

import { extractImage, parseAttachments, buildUserMessage } from "./attachments.js";

async function main() {
  const program = new Command();

  program
    .name("terrible-harness")
    .description("The most terrible harness you've ever seen.")
    .version("1.7.2 (Rebrand)")
    .argument("[prompt...]", "Ask it something. (one shot mode)")
    .option("-p, --provider <provider>", "Ur provider. (groq, openai, anthropic, ollama, custom)")
    .option("-m, --model <model>", "The model's name.")
    .option("-c, --config <path>", "path to your config.json (created if doesnt exist)")
    .option("--stateless", "Isolates the model from .context.json")
    .option("--think", "Show what it thinks.")
    .option("--yolo", "Let the model go hay with your tools")
    .option("--clear", "Destroy .context.json but you know rm -rf .context.json works")
    .helpOption("-h, --help", "This?");

  program.parse(process.argv);

  const options = program.opts();
  const promptArgs = program.args;

  // Handle --clear flag
  if (options.clear) {
    clearContext();
    console.log(chalk.green("D- Done... but you could've just rm -f .context.json!!"));
    process.exit(0);
  }

  // Load configuration
  let config = loadConfig(options.config);

  // If no config found and in interactive terminal, run setup wizard
  if (!config) {
    if (process.stdin.isTTY) {
      config = await runConfigWizard();
    } else {
      console.error(chalk.red("Nah you havent created .config.json?? THERE'S NO ENVIORNMENT OVERRIDE??"));
      console.error(chalk.yellow("Just run npx terrible-harness already or set your keys in .env :wilted_rose:"));
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
  const stdinBuf = await readStdin();
  const image = extractImage(stdinBuf);
  const stdinContent = image ? "" : stdinBuf.toString("utf8").trim();

  let finalPrompt = "";
  if (stdinContent && promptArgs.length > 0) {
    finalPrompt = `${promptArgs.join(" ")}\n\n[Piped Input]:\n${stdinContent}`;
  } else if (stdinContent) {
    finalPrompt = stdinContent;
  } else if (promptArgs.length > 0) {
    finalPrompt = promptArgs.join(" ");
  } else if (image) {
    finalPrompt = "Describe this image.";
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

  const att = parseAttachments(finalPrompt);
  const images = [...att.images, ...(image ? [{ ...image, name: "stdin" }] : [])];
  const msg = buildUserMessage(att.text, images);

  context.push({ role: "user", content: msg.stored });
  if (!isStateless) saveContext(context);

  const callMessages: any[] =
    typeof msg.content === "string"
      ? context
      : [...context.slice(0, -1), { role: "user", content: msg.content }];

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
        messages: callMessages,   // was: context
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
