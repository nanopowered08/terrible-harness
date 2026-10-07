import { Command } from "commander"; import chalk from "chalk";           import { loadConfig, runConfigWizard } from "./config.js";                import { loadContext, saveContext, clearContext, loadSystemPrompt } from "./context.js";                       import { ReasoningManager } from "./reasoning.js";                        import { streamChatResponse } from "./providers/ai-sdk.js";               import { executeCustomApi } from "./providers/custom.js";                 import { startRepl } from "./repl.js";                                    import { AskGptConfig, ChatMessage, ProviderType } from "./types.js";     
async function readStdin(): Promise<Buffer> {
  if (process.stdin.isTTY) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  try {
    for await (const c of process.stdin) chunks.push(c as Buffer);
  } catch {}
  return Buffer.concat(chunks);
}

function sniffImage(b: Buffer): string | null {
  const s = (a: number, e: number) => b.subarray(a, e).toString("latin1");
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (s(1, 4) === "PNG") return "image/png";
  if (s(0, 3) === "GIF") return "image/gif";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "image/webp";
  return null;
}

// Accepts raw image bytes OR base64 text of an image
function extractImage(b: Buffer): { data: Buffer; mediaType: string } | null {
  let mt = sniffImage(b);
  if (mt) return { data: b, mediaType: mt };
  const head = b.subarray(0, 200).toString("utf8");
  if (/^[A-Za-z0-9+/=\s]+$/.test(head)) {
    const decoded = Buffer.from(b.toString("utf8").trim(), "base64");
    mt = sniffImage(decoded);
    if (mt) return { data: decoded, mediaType: mt };
  }
  return null;
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
  const stdinBuf = await readStdin();
  const image = extractImage(stdinBuf);
  console.error("image:", image?.mediaType, image?.data.length);
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

  context.push({
    role: "user",
    content: image
      ? `${finalPrompt}\n[image attached: ${image.mediaType}, ${image.data.length} bytes]`
      : finalPrompt,
  });
  if (!isStateless) saveContext(context);

  const callMessages: any[] = image
    ? [
        ...context.slice(0, -1),
        {
          role: "user",
          content: [
            { type: "text", text: finalPrompt },
            { type: "image", image: image.data, mediaType: image.mediaType },
          ],
        },
      ]
    : context;
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