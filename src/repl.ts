import { parseAttachments, buildUserMessage } from "./attachments.js";
import readline from "readline";
import chalk from "chalk";
import { AskGptConfig, ChatMessage } from "./types.js";
import { loadContext, saveContext, clearContext, loadSystemPrompt, loadReasoning, CONTEXT_FILE, SYSTEM_FILE, REASONING_FILE } from "./context.js";
import { ReasoningManager } from "./reasoning.js";
import { streamChatResponse } from "./providers/ai-sdk.js";
import { executeCustomApi } from "./providers/custom.js";
import { getTools } from "./tools/index.js";
import { createTurnGuard, createInterrupt, isAbortError } from "./Guards.js";

export async function startRepl(config: AskGptConfig): Promise<void> {
  const context = loadContext();
  let systemPrompt = loadSystemPrompt();
  let thinkingVisible = config.thinking?.defaultVisible ?? false;

  console.log(chalk.bold.hex("#7c3aed")("\n┌───────────────────────────────────────────────┐"));
  console.log(chalk.bold.hex("#7c3aed")("│             terrible-harness                  │"));
  console.log(chalk.bold.hex("#7c3aed")("└───────────────────────────────────────────────┘"));
  console.log(chalk.gray(`Provider:       ${chalk.cyan(config.provider)}`));
  console.log(chalk.gray(`Model:          ${chalk.green(config.model)}`));
  console.log(chalk.gray(`Context:        ${context.length > 0 ? chalk.yellow(`${context.length} messages loaded from ${CONTEXT_FILE}`) : chalk.dim(`empty (${CONTEXT_FILE})`)}`));
  console.log(chalk.gray(`System Prompt:  ${systemPrompt ? chalk.green(`loaded from ${SYSTEM_FILE}`) : chalk.dim(`none (${SYSTEM_FILE})`)}`));
  console.log(chalk.gray(`Thinking:       ${thinkingVisible ? chalk.green("Visible") : chalk.yellow("Hidden (piping to " + REASONING_FILE + ")")} [Ctrl+T to toggle]`));
  console.log(chalk.gray(`Tools:          ${chalk.cyan("execute_command, read_file, write_file, search_web")}`));
  console.log(chalk.dim("Type /help for slash commands, or type your message to chat.\n"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.blue("terrible-harness> ")
  });

  readline.emitKeypressEvents(process.stdin, rl);

  // Staged: Guards
  const turn = createTurnGuard();
  const interrupt = createInterrupt();

  const handleSlashCommand = async (cmd: string): Promise<boolean> => {
    const trimmed = cmd.trim();
    if (trimmed === "/clear") {
      clearContext();
      context.length = 0;
      console.log(chalk.green("Context cleared. Started fresh conversation."));
      return true;
    }
    if (trimmed === "/system") {
      systemPrompt = loadSystemPrompt();
      if (systemPrompt) {
        console.log(chalk.cyan(`\nCurrent System Prompt (${SYSTEM_FILE}):\n`));
        console.log(chalk.white(systemPrompt));
      } else {
        console.log(chalk.yellow(`No ${SYSTEM_FILE} found. Create a .system.txt file to set custom instructions.`));
      }
      return true;
    }
    if (trimmed === "/think") {
      thinkingVisible = !thinkingVisible;
      console.log(chalk.magenta(`Thinking visibility is now: ${thinkingVisible ? "ON" : "OFF"}`));
      return true;
    }
    if (trimmed === "/reasoning") {
      const reasoningData = loadReasoning();
      if (reasoningData && reasoningData.reasoning) {
        console.log(chalk.magenta(`\nLast Reasoning [${reasoningData.model} @ ${reasoningData.timestamp}]:\n`));
        console.log(chalk.dim.italic(reasoningData.reasoning));
      } else {
        console.log(chalk.yellow("No saved reasoning found in .reasoning.json yet."));
      }
      return true;
    }
    if (trimmed === "/tools") {
      const tools = await getTools({ autoApprove: config.autoApproveTools, provider: config.provider });
      console.log(chalk.cyan("\nAvailable Tools:"));
      for (const [name, t] of Object.entries(tools)) {
        console.log(` - ${chalk.green(name)}: ${(t as any).description || ""}`);
      }
      return true;
    }
    if (trimmed === "/model") {
      console.log(chalk.cyan(`Current Provider: ${config.provider}`));
      console.log(chalk.green(`Current Model:    ${config.model}`));
      return true;
    }
    if (trimmed === "/help") {
      console.log(chalk.bold("\nAvailable Commands:"));
      console.log(`  ${chalk.cyan("/clear")}                     Clear conversation history in .context.json`);
      console.log(`  ${chalk.cyan("/system")}                    Reload and display .system.txt`);
      console.log(`  ${chalk.cyan("/think")}                     Toggle thinking visibility (or press Ctrl+T)`);
      console.log(`  ${chalk.cyan("/reasoning")}                 View last reasoning trace from .reasoning.json`);
      console.log(`  ${chalk.cyan("/tools")}                     List available tools`);
      console.log(`  ${chalk.cyan("/model")}                     Show current provider and model`);
      console.log(`  ${chalk.cyan("/help")}                      Show this help message`);
      console.log(`  ${chalk.cyan("/exit")}                      Exit askgpt`);
      console.log(`  ${chalk.cyan("/file=(path to file)")}       Import a file into the message turn`);
      console.log(`  ${chalk.cyan("/image=(path to image)")}     Import a image into the message turn\n`);
      return true;
    }
    if (trimmed === "/exit" || trimmed === "/quit") {
      console.log(chalk.yellow("Goodbye!"));
      process.exit(0);
    }
    return false;
  };

  const askNext = () => {
    rl.prompt();
  };

  const handleLine = async (line: string) => {
    const input = line.trim();
    if (!input) {
      askNext();
      return;
    }

    if (input.startsWith("/")) {
      const handled = await handleSlashCommand(input);
      if (handled) {
        askNext();
        return;
      }
    }

    // Add user message
    let msg;
    try {
      const att = parseAttachments(input);
      msg = buildUserMessage(att.text || (att.images.length ? "" : input), att.images);
    } catch (e: any) {
      console.error(chalk.red(`${e.message}\n`));
      askNext();
      return;
    }

    context.push({ role: "user", content: msg.stored });
    saveContext(context);

    const callMessages: any[] =
      typeof msg.content === "string"
        ? context
        : [...context.slice(0, -1), { role: "user", content: msg.content }];

    // Setup reasoning manager
    const reasoningManager = new ReasoningManager(thinkingVisible, config.model);
    interrupt.reset();

    // Pause readline while processing response
    rl.pause();

    // Hook Ctrl+T keypress during generation
    let rawModeOriginal = false;
    let onKeypressDuringStream: ((str: string, key: any) => void) | null = null;

    if (process.stdin.isTTY) {
      rawModeOriginal = Boolean(process.stdin.isRaw);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      onKeypressDuringStream = (_str: string, key: any) => {
        if (key && (key.sequence === "\x14" || (key.ctrl && key.name === "t"))) {
          if (!reasoningManager.getVisible()) {
            thinkingVisible = true;
            reasoningManager.setVisible(true);
          }
        } else if (key && key.ctrl && key.name === "c") {
          process.stdout.write("\n" + chalk.yellow("[Interrupted by user]\n"));
          interrupt.abort();   // the finally block restores the terminal and prompts once
        }
      };

      process.stdin.on("keypress", onKeypressDuringStream);
    }

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
          messages: callMessages,
          systemPrompt,
          abortSignal: interrupt.signal,
          reasoningManager,
          enableTools: true,
          onContentChunk: (chunk) => {
            process.stdout.write(chunk);
          },
        });
      }

      process.stdout.write("\n\n");

      if (assistantText.trim()) {
        context.push({ role: "assistant", content: assistantText });
        saveContext(context);
      }
    } catch (err: any) {
      if (!isAbortError(err)) {
        console.error(chalk.red(`\nError: ${err.message}\n`));
      }
    } finally {
      if (process.stdin.isTTY && onKeypressDuringStream) {
        process.stdin.removeListener("keypress", onKeypressDuringStream);
        process.stdin.setRawMode(rawModeOriginal);
      }
      rl.resume();
      askNext();
    }
  };

  rl.on("line", async (line) => {
    await turn.run(() => handleLine(line)); // dropped while a turn is running
  });

  rl.on("close", () => {
    console.log(chalk.yellow("\nSession closed."));
    process.exit(0);
  });

  // Prompt first input
  askNext();
}
