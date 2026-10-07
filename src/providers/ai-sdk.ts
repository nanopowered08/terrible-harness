import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { streamText, isStepCount } from "ai";
import { AskGptConfig, ChatMessage } from "../types.js";
import { ReasoningManager, InlineThinkFilter } from "../reasoning.js";
import { getTools } from "../tools/index.js";
import chalk from "chalk";

export function getModel(config: AskGptConfig): any {
  switch (config.provider) {
    case "groq": {
      const groq = createGroq({
        apiKey: config.apiKey || process.env.GROQ_API_KEY
      });
      return groq(config.model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY
      });
      return anthropic(config.model);
    }
    case "ollama": {
      const openai = createOpenAI({
        baseURL: config.baseURL || "http://localhost:11434/v1",
        apiKey: config.apiKey || "ollama"
      });
      return openai(config.model);
    }
    case "openai":
    default: {
      const openai = createOpenAI({
        apiKey: config.apiKey || process.env.OPENAI_API_KEY,
        baseURL: config.baseURL
      });
      return openai(config.model);
    }
  }
}

export interface StreamResponseOptions {
  config: AskGptConfig;
  messages: ChatMessage[];
  systemPrompt: string | null;
  reasoningManager: ReasoningManager;
  enableTools?: boolean;
  onContentChunk?: (chunk: string) => void;
}

export async function streamChatResponse(options: StreamResponseOptions): Promise<string> {
  const { config, messages, systemPrompt, reasoningManager, enableTools = true, onContentChunk } = options;

  const model = getModel(config);
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content;
  const tools = enableTools
    ? await getTools({
        autoApprove: config.autoApproveTools,
        provider: config.provider,
        lastUserPrompt: lastUserMessage
      })
    : undefined;

  // Format messages for AI SDK
  const formattedMessages: any[] = messages.map((m) => ({
    role: m.role,
    content: m.content
  }));

  const inlineFilter = new InlineThinkFilter(
    (chunk) => reasoningManager.handleThinkingChunk(chunk),
    () => reasoningManager.startThinking(),
    () => reasoningManager.endThinking()
  );

  let hasStartedNativeReasoning = false;
  let fullAssistantText = "";

  const stream = streamText({
    model,
    system: systemPrompt || undefined,
    messages: formattedMessages,
    tools: tools,
    stopWhen: isStepCount(10)
  });

  for await (const part of stream.fullStream) {
    const partType = part.type;

    if (partType === "reasoning-start") {
      hasStartedNativeReasoning = true;
      reasoningManager.startThinking();
    } else if (partType === "reasoning" || partType === "reasoning-delta") {
      if (!hasStartedNativeReasoning) {
        hasStartedNativeReasoning = true;
        reasoningManager.startThinking();
      }
      const text = (part as any).text ?? (part as any).textDelta ?? "";
      if (text) {
        reasoningManager.handleThinkingChunk(text);
      }
    } else if (partType === "reasoning-end") {
      if (hasStartedNativeReasoning) {
        hasStartedNativeReasoning = false;
        reasoningManager.endThinking();
      }
    } else if (partType === "text-delta") {
      if (hasStartedNativeReasoning) {
        hasStartedNativeReasoning = false;
        reasoningManager.endThinking();
      }

      const rawText = (part as any).text ?? (part as any).textDelta ?? "";
      // Check for inline <think> tags in the text chunk
      const filteredText = inlineFilter.process(rawText);
      if (filteredText) {
        fullAssistantText += filteredText;
        if (onContentChunk) {
          onContentChunk(filteredText);
        } else {
          process.stdout.write(filteredText);
        }
      }
    } else if (partType === "tool-call") {
      const toolName = (part as any).toolName || "tool";
      console.log(chalk.cyan(`\n[Calling tool ${toolName}]...`));
    } else if (partType === "tool-result") {
      const toolName = (part as any).toolName || "tool";
      console.log(chalk.gray(`[Tool ${toolName} completed]`));
    } else if (partType === "error") {
      console.error(chalk.red(`\nStream Error: ${(part as any).error}`));
    }
  }

  // Clean up any remaining thinking state
  if (hasStartedNativeReasoning || inlineFilter.isInThink()) {
    reasoningManager.endThinking();
  }

  return fullAssistantText;
}
