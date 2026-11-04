import { parseAttachments, buildUserMessage } from "./attachments.js";
import readline from "readline";
import chalk from "chalk";
import type { AskGptConfig } from "./types.js";
import {
  loadContext,
  saveContext,
  clearContext,
  loadSystemPrompt,
  loadReasoning,
  CONTEXT_FILE,
  SYSTEM_FILE,
  REASONING_FILE
} from "./context.js";
import { ReasoningManager } from "./reasoning.js";
import { streamChatResponse } from "./providers/ai-sdk.js";
import { withToolNotes } from "./tool-memory.js";
import { executeCustomApi } from "./providers/custom.js";
import { getTools, getToolOrigins } from "./tools/index.js";
import { closeMcpClients } from "./tools/mcp.js";
import { runEdit, type EditHost } from "./edit.js";
import { createInterrupt, isAbortError } from "./Guards.js";
import {
  maybeSummarize,
  resolveSystemPrompt,
  resolveUserPrompt,
  GLOBAL_SYSTEM_FILE
} from "./Summarize.js";

export async function startRepl(config: AskGptConfig): Promise<void> {
  const context = loadContext();
  const interrupt = createInterrupt();

  let preferGlobal = false;
  let systemPrompt = resolveSystemPrompt(loadSystemPrompt(), preferGlobal);
  let thinkingVisible = config.thinking?.defaultVisible ?? false;
  let shouldExit = false;

  const PROMPT = chalk.bold.blue("terrible-harness> ");
  let history: string[] = [];

  console.log(chalk.bold.hex("#7c3aed")("\n┌───────────────────────────────────────────────┐"));
  console.log(chalk.bold.hex("#7c3aed")("│             terrible-harness                  │"));
  console.log(chalk.bold.hex("#7c3aed")("└───────────────────────────────────────────────┘"));
  const printModelLines = (): void => {
    console.log(chalk.gray(`Provider:       ${chalk.cyan(config.provider)}`));
    console.log(chalk.gray(`Model:          ${chalk.green(config.model)}`));
  };
  printModelLines();
  console.log(
    chalk.gray(
      `Context:        ${
        context.length > 0
          ? chalk.yellow(`${context.length} messages loaded from ${CONTEXT_FILE}`)
          : chalk.dim(`empty (${CONTEXT_FILE})`)
      }`
    )
  );

  const promptSource = loadSystemPrompt() ? SYSTEM_FILE : GLOBAL_SYSTEM_FILE;
  console.log(
    chalk.gray(
      `System Prompt:  ${
        resolveUserPrompt(loadSystemPrompt(), preferGlobal) ? chalk.green(`loaded from ${promptSource}`) : chalk.dim(`none (${SYSTEM_FILE})`)
      }`
    )
  );
  console.log(
    chalk.gray(
      `Thinking:       ${
        thinkingVisible
          ? chalk.green("Visible")
          : chalk.yellow(`Hidden (piping to ${REASONING_FILE})`)
      } [Ctrl+T to toggle]`
    )
  );
  const printToolSummary = async (): Promise<void> => {
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      console.log(chalk.dim("Connecting to MCP servers..."));
    }
    const loadedTools = await getTools({
      autoApprove: config.autoApproveTools,
      provider: config.provider,
      mcpServers: config.mcpServers
    });
    const origins = getToolOrigins();
    const localNames = Object.keys(loadedTools).filter((n) => origins.get(n)?.kind !== "mcp");
    console.log(chalk.gray(`Tools:          ${chalk.cyan(localNames.join(", "))}`));

    const mcpCounts = new Map<string, number>();
    for (const [name] of Object.entries(loadedTools)) {
      const o = origins.get(name);
      if (o?.kind === "mcp" && o.server) mcpCounts.set(o.server, (mcpCounts.get(o.server) ?? 0) + 1);
    }
    if (mcpCounts.size > 0) {
      const summary = [...mcpCounts].map(([server, n]) => `${server} (${n} tool${n === 1 ? "" : "s"})`).join(", ");
      console.log(chalk.gray(`MCP:            ${chalk.cyan(summary)}`));
    }
  };
  await printToolSummary();
  console.log(chalk.dim("Type /help for slash commands, or type your message to chat.\n"));

  readline.emitKeypressEvents(process.stdin);

  // What the /edit commands can change in this session
  const editHost: EditHost = {
    getConfig: () => config,
    updateConfig: (patch) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete (config as any)[key];
        else (config as any)[key] = value;
      }
      if ("thinking" in patch) thinkingVisible = config.thinking?.defaultVisible ?? false;
    },
    replaceConfig: async (next) => {
      await closeMcpClients();
      config = next;
      thinkingVisible = next.thinking?.defaultVisible ?? false;
      console.log("");
      printModelLines();
      await printToolSummary();
    },
    applyMcpServers: async () => {
      await closeMcpClients();
      console.log("");
      await printToolSummary();
    },
    getPreferGlobal: () => preferGlobal,
    reloadSystemPrompt: () => {
      systemPrompt = resolveSystemPrompt(loadSystemPrompt(), preferGlobal);
      return resolveUserPrompt(loadSystemPrompt(), preferGlobal);
    }
  };

  const handleSlashCommand = async (cmd: string): Promise<boolean> => {
    const trimmed = cmd.trim();

    if (trimmed === "/edit" || trimmed.startsWith("/edit ")) {
      await runEdit(trimmed.slice(5), editHost);
      return true;
    }

    if (trimmed === "/clear") {
      clearContext();
      context.length = 0;
      console.log(chalk.green("Context cleared. Started fresh conversation."));
      return true;
    }

    if (trimmed === "/system global" || trimmed === "/system local") {
      preferGlobal = trimmed === "/system global";
      systemPrompt = resolveSystemPrompt(loadSystemPrompt(), preferGlobal);

      console.log(
        chalk.green(
          preferGlobal
            ? `System prompt source: ${GLOBAL_SYSTEM_FILE}`
            : `System prompt source: local ${SYSTEM_FILE} (global as fallback)`
        )
      );
      return true;
    }

    if (trimmed === "/system") {
      systemPrompt = resolveSystemPrompt(loadSystemPrompt(), preferGlobal);

      const userPrompt = resolveUserPrompt(loadSystemPrompt(), preferGlobal);

      if (userPrompt) {
        console.log(chalk.cyan(`\nCurrent System Prompt (${SYSTEM_FILE}):\n`));
        console.log(chalk.white(userPrompt));
        console.log(chalk.dim("\n(The constitution and harness rules are always added on top.)"));
      } else {
        console.log(
          chalk.yellow(`No ${SYSTEM_FILE} found. Create a .system.txt file to set custom instructions.`)
        );
      }

      return true;
    }

    if (trimmed === "/think") {
      thinkingVisible = !thinkingVisible;
      console.log(
        chalk.magenta(`Thinking visibility is now: ${thinkingVisible ? "ON" : "OFF"}`)
      );
      return true;
    }

    if (trimmed === "/reasoning") {
      const reasoningData = loadReasoning();

      if (reasoningData?.reasoning) {
        console.log(
          chalk.magenta(
            `\nLast Reasoning [${reasoningData.model} @ ${reasoningData.timestamp}]:\n`
          )
        );
        console.log(chalk.dim.italic(reasoningData.reasoning));
      } else {
        console.log(chalk.yellow("No saved reasoning found in .reasoning.json yet."));
      }

      return true;
    }

    if (trimmed === "/tools") {
      const tools = await getTools({
        autoApprove: config.autoApproveTools,
        provider: config.provider,
        mcpServers: config.mcpServers
      });
      const origins = getToolOrigins();

      const groups = new Map<string, [string, any][]>();
      for (const [name, tool] of Object.entries(tools)) {
        const o = origins.get(name);
        const label = o?.kind === "mcp" ? `MCP: ${o.server}` : o?.kind === "custom" ? "Custom (tools/)" : "Built-in";
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label)!.push([name, tool]);
      }

      console.log(chalk.cyan("\nAvailable Tools:"));
      for (const [label, list] of groups) {
        console.log(chalk.bold(`\n${label}`));
        for (const [name, tool] of list) {
          const desc = String((tool as any).description || "").replace(/\s+/g, " ");
          console.log(` - ${chalk.green(name)}: ${desc.length > 140 ? desc.slice(0, 140) + "..." : desc}`);
        }
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
      console.log(`  ${chalk.cyan("/image=(path to image)")}     Import an image into the message turn\n`);
      console.log(`  ${chalk.cyan("/summarize")}                 Summarize the context now (auto at 75% of the window)`);
      console.log(`  ${chalk.cyan("/edit cfg")}                   Look through / change config.json options, or load another configuration`);
      console.log(`  ${chalk.cyan("/edit mcp")}                   Add, change or remove MCP servers`);
      console.log(`  ${chalk.cyan("/edit system")}                Edit the system prompt in your text editor and reload it`);
      console.log(`  ${chalk.cyan("/system global|local")}       Prefer ~/.terrible-harness/.system.txt or the local .system.txt`);
      return true;
    }

    if (trimmed === "/summarize") {
      await maybeSummarize({
        config,
        context,
        systemPrompt,
        save: saveContext,
        force: true
      });
      return true;
    }

    if (trimmed === "/exit" || trimmed === "/quit") {
      console.log(chalk.yellow("Goodbye!"));
      shouldExit = true;
      return true;
    }

    return false;
  };

  const handleLine = async (line: string): Promise<void> => {
    const input = line.trim();

    if (!input) return;

    if (input.startsWith("/")) {
      const handled = await handleSlashCommand(input);
      if (handled) return;
    }

    let msg;

    try {
      const attachments = parseAttachments(input);
      msg = buildUserMessage(
        attachments.text || (attachments.images.length ? "" : input),
        attachments.images
      );
    } catch (error: any) {
      console.error(chalk.red(`${error.message}\n`));
      return;
    }

    await maybeSummarize({
      config,
      context,
      systemPrompt,
      pendingText: input,
      save: saveContext
    });

    context.push({ role: "user", content: msg.stored });
    saveContext(context);

    const callMessages: any[] =
      typeof msg.content === "string"
        ? context
        : [...context.slice(0, -1), { role: "user", content: msg.content }];

    const reasoningManager = new ReasoningManager(thinkingVisible, config.model);

    // Each generation gets its own cancellation signal.
    interrupt.reset();
    const turnSignal = interrupt.signal;

    let originalRawMode = false;
    let rawModeChanged = false;
    let cancelledMessageShown = false;

    const cancelTurn = (): void => {
      if (turnSignal.aborted) return;

      process.stdout.write("\n" + chalk.yellow("[Interrupted by user]\n"));
      cancelledMessageShown = true;
      interrupt.abort();
    };

    const onKeypress = (_str: string, key: any): void => {
      if (!key) return;

      if (key.ctrl && key.name === "t") {
        thinkingVisible = !reasoningManager.getVisible();
        reasoningManager.setVisible(thinkingVisible);

        process.stdout.write(
          "\n" +
            chalk.magenta(
              `Thinking visibility is now: ${thinkingVisible ? "ON" : "OFF"}`
            ) +
            "\n"
        );
        return;
      }

      if (key.ctrl && key.name === "c") {
        cancelTurn();
      }
    };

    // Fallback for environments where Ctrl+C arrives as a process signal.
    const onProcessSigint = (): void => {
      cancelTurn();
    };

    try {
      if (process.stdin.isTTY) {
        originalRawMode = Boolean(process.stdin.isRaw);

        if (!originalRawMode) {
          process.stdin.setRawMode(true);
          rawModeChanged = true;
        }

        process.stdin.resume();
        process.stdin.on("keypress", onKeypress);
      }

      process.on("SIGINT", onProcessSigint);

      let assistantText = "";
      const toolRecords: string[] = [];

      if (config.provider === "custom") {
        assistantText = await executeCustomApi(
          config,
          context,
          systemPrompt,
          reasoningManager,
          (chunk) => {
            if (!turnSignal.aborted) process.stdout.write(chunk);
          },
          turnSignal
        );
      } else {
        assistantText = await streamChatResponse({
          config,
          messages: callMessages,
          systemPrompt,
          abortSignal: turnSignal,
          reasoningManager,
          enableTools: true,
          toolRecords,
          onContentChunk: (chunk) => {
            if (!turnSignal.aborted) process.stdout.write(chunk);
          }
        });
      }

      if (turnSignal.aborted) {
        // A provider may resolve with partial output after cancellation.
        // Do not save that partial output as a completed assistant turn.
        if (!cancelledMessageShown) {
          process.stdout.write(chalk.yellow("[Generation cancelled]\n"));
        }
      } else {
        process.stdout.write("\n\n");

        if (assistantText.trim() || toolRecords.length) {
          context.push({ role: "assistant", content: withToolNotes(toolRecords, assistantText) });
          saveContext(context);
        }
      }
    } catch (error: any) {
      if (turnSignal.aborted || isAbortError(error)) {
        if (!cancelledMessageShown) {
          process.stdout.write(chalk.yellow("\n[Generation cancelled]\n"));
        }
      } else {
        console.error(chalk.red(`\nError: ${error?.message ?? String(error)}\n`));
        // Drop the unanswered user message so a retry doesn't send it twice
        if (context[context.length - 1]?.role === "user") {
          context.pop();
          saveContext(context);
        }
      }
    } finally {
      process.removeListener("SIGINT", onProcessSigint);

      if (process.stdin.isTTY) {
        process.stdin.removeListener("keypress", onKeypress);

        if (rawModeChanged) {
          process.stdin.setRawMode(originalRawMode);
        }
      }
    }
  };

  // Prompt input and generation input are handled in separate phases:
  // readline is closed before a turn begins, so it cannot compete with
  // the generation-time keypress handler.
  while (!shouldExit) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      history,
      historySize: 100
    });

    const line = await new Promise<string | null>((resolve) => {
      let settled = false;

      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      rl.once("close", () => finish(null));
      rl.question(PROMPT, (answer) => finish(answer));
    });

    history = (rl as any).history ?? history;
    rl.close();

    if (line === null) {
      console.log(chalk.yellow("\nSession closed."));
      break;
    }

    try {
      await handleLine(line);
    } catch (error: any) {
      console.error(chalk.red(`\nError: ${error?.message ?? String(error)}\n`));
    }
  }
}

