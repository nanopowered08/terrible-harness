import {
  parseAttachments,
  buildUserMessage,
} from "../attachments.js";
import {
  loadContext,
  saveContext,
  loadSystemPrompt,
} from "../context.js";
import { ReasoningManager } from "../reasoning.js";
import { streamChatResponse } from "../providers/ai-sdk.js";
import { executeCustomApi } from "../providers/custom.js";
import type { AskGptConfig, ChatMessage } from "../types.js";
import type { resolveInput } from "./input.js";

type ResolvedInput = Awaited<ReturnType<typeof resolveInput>>;

export async function executeOneShot(
  config: AskGptConfig,
  input: ResolvedInput,
  isStateless: boolean,
  think: boolean,
): Promise<void> {
  const { image, finalPrompt } = input;

  const context: ChatMessage[] = isStateless ? [] : loadContext();
  const systemPrompt = loadSystemPrompt();

  const att = parseAttachments(finalPrompt);
  const images = [
    ...att.images,
    ...(image ? [{ ...image, name: "stdin" }] : []),
  ];
  const msg = buildUserMessage(att.text, images);

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

  if (config.provider === "custom") {
    assistantText = await executeCustomApi(
      config,
      context,
      systemPrompt,
      reasoningManager,
      (chunk) => process.stdout.write(chunk),
    );
  } else {
    assistantText = await streamChatResponse({
      config,
      messages: callMessages,
      systemPrompt,
      reasoningManager,
      enableTools: true,
      onContentChunk: (chunk) => process.stdout.write(chunk),
    });
  }

  process.stdout.write("\n");

  if (!isStateless && assistantText.trim()) {
    context.push({ role: "assistant", content: assistantText });
    saveContext(context);
  }
}
