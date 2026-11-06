import {
  parseAttachments,
  buildUserMessage,
} from "../attachments.js";
import {
  loadContext,
  saveContext,
  loadSystemPrompt,
} from "../context.js";
import { maybeSummarize, resolveSystemPrompt } from "../Summarize.js";
import chalk from "chalk";
import { ReasoningManager } from "../reasoning.js";
import { streamChatResponse } from "../providers/ai-sdk.js";
import { withToolNotes } from "../tool-memory.js";
import { executeCustomApi } from "../providers/custom.js";
import type { AskGptConfig, ChatMessage } from "../types.js";
import type { resolveInput } from "./input.js";

type ResolvedInput = Awaited<ReturnType<typeof resolveInput>>;

export interface OneShotOptions {
  onContentChunk?: (chunk: string) => void;
}

export async function executeOneShot(
  config: AskGptConfig,
  input: ResolvedInput,
  isStateless: boolean,
  think: boolean,
  options: OneShotOptions = {},
): Promise<string> {
  const { image, finalPrompt } = input;

  const context: ChatMessage[] = isStateless ? [] : loadContext();
  const systemPrompt = resolveSystemPrompt(loadSystemPrompt());

  const att = parseAttachments(finalPrompt);
  const images = [
    ...att.images,
    ...(image ? [{ ...image, name: "stdin" }] : []),
  ];
  const msg = buildUserMessage(att.text, images);

  if (!isStateless) {
    await maybeSummarize({
      config,
      context,
      systemPrompt,
      pendingText: att.text,
      save: saveContext,
    });
  }

  context.push({ role: "user", content: msg.stored });

  if (!isStateless) {
    saveContext(context);
  }

  const callMessages: any[] =
    typeof msg.content === "string"
      ? context
      : [
          ...context.slice(0, -1),
          { role: "user", content: msg.content },
        ];

  const thinkingVisible = Boolean(
    think || config.thinking?.defaultVisible,
  );

  const reasoningManager = new ReasoningManager(
    thinkingVisible,
    config.model,
  );

  let assistantText = "";
  const toolRecords: string[] = [];

  try {
    if (config.provider === "custom") {
      assistantText = await executeCustomApi(
        config,
        context,
        systemPrompt,
        reasoningManager,
        options.onContentChunk ?? ((chunk) => process.stdout.write(chunk)),
      );
    } else {
      assistantText = await streamChatResponse({
        config,
        messages: callMessages,
        systemPrompt,
        reasoningManager,
        enableTools: true,
        toolRecords,
        onContentChunk: options.onContentChunk ?? ((chunk) => process.stdout.write(chunk)),
      });
    }
  } catch (error: any) {
    if (!options.onContentChunk) console.error(chalk.red(`\nError: ${error?.message ?? String(error)}`));
    // Don't leave a user message with no reply in .context.json
    if (!isStateless) {
      context.pop();
      saveContext(context);
    }
    throw error;
  }

  if (!options.onContentChunk) process.stdout.write("\n");

  if (!isStateless && (assistantText.trim() || toolRecords.length)) {
    context.push({ role: "assistant", content: withToolNotes(toolRecords, assistantText) });
    saveContext(context);
  }
  return assistantText;
}
