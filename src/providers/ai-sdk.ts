import { summarizeToolCall } from "../tool-memory.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createLoopDetectionCondition } from "../loop-detection.js";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { streamText, isStepCount } from "ai";
import { AskGptConfig, ChatMessage } from "../types.js";
import { ReasoningManager, InlineThinkFilter } from "../reasoning.js";
import { getTools } from "../tools/index.js";
import chalk from "chalk";

export const DEFAULT_MAX_STEPS = 50;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  const msg = (e as any)?.message;
  if (typeof msg === "string") return msg;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function getModel(config: AskGptConfig): any {
  switch (config.provider) {
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey:
          config.apiKey ||
          process.env.GEMINI_API_KEY ||
          process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });

      return google(config.model || "gemini-3.5-flash-lite");
    }
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
  abortSignal?: AbortSignal;
  /** Filled with one short line per tool call, so the caller can save them with the reply. */
  toolRecords?: string[];
  /** Use this model instead of building one from config (used by tests). */
  model?: any;
}

export async function streamChatResponse(options: StreamResponseOptions): Promise<string> {
  const { config, messages, systemPrompt, reasoningManager, enableTools = true, onContentChunk, abortSignal, toolRecords } = options;

  const model = options.model ?? getModel(config);
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content;
  const tools = enableTools
    ? await getTools({
        autoApprove: config.autoApproveTools,
        provider: config.provider,
        lastUserPrompt: lastUserMessage,
        mcpServers: config.mcpServers
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
  const toolInputs = new Map<string, any>();
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  let stepCount = 0;
  let lastFinishReason: string | undefined;
  let streamError: unknown = undefined;

  const stream = streamText({
    model,
    system: systemPrompt || undefined,
    messages: formattedMessages,
    tools,
    abortSignal,
    providerOptions: config.providerOptions,
    onError: () => {}, // errors arrive as "error" parts below; the default handler dumps the whole object to stderr
    stopWhen: [createLoopDetectionCondition(), isStepCount(maxSteps)]
  });

  for await (const part of stream.fullStream) {
    const partType = part.type;
    if (abortSignal?.aborted || (partType as string) === "abort") break;

    if (partType === "reasoning-start") {
      hasStartedNativeReasoning = true;
      reasoningManager.startThinking();
    } else if (partType === "reasoning-delta") {
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
    } else if (partType === "text-start") {
      // Text from different steps used to be glued together in the saved reply.
      if (fullAssistantText && !/\s$/.test(fullAssistantText)) fullAssistantText += "\n\n";
    } else if (partType === "finish-step") {
      stepCount++;
      lastFinishReason = (part as any).finishReason;
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
      toolInputs.set((part as any).toolCallId, (part as any).input ?? (part as any).args);
      console.log(chalk.cyan(`\n[Calling tool ${toolName}]...`));
    } else if (partType === "tool-result") {
      const toolName = (part as any).toolName || "tool";
      const out = (part as any).output ?? (part as any).result;
      toolRecords?.push(
        summarizeToolCall(toolName, (part as any).input ?? toolInputs.get((part as any).toolCallId), out)
      );
      if (out?.rejected) {
        console.log(chalk.yellow(`[Tool ${toolName} rejected]`));
      } else if (out?.success === false || out?.error || out?.isError === true) {
        console.log(chalk.red(`[Tool ${toolName} failed]`));
      } else if (typeof out?.exitCode === "number" && out.exitCode !== 0) {
        console.log(chalk.red(`[Tool ${toolName} failed (exit ${out.exitCode})]`));
      } else {
        console.log(chalk.gray(`[Tool ${toolName} completed]`));
      }
    } else if (partType === "tool-error") {
      const toolName = (part as any).toolName || "tool";
      const message = errorMessage((part as any).error);
      toolRecords?.push(
        summarizeToolCall(toolName, (part as any).input ?? toolInputs.get((part as any).toolCallId), {
          success: false,
          error: message
        })
      );
      console.log(chalk.red(`[Tool ${toolName} failed: ${message}]`));
    } else if (partType === "error") {
      if (!abortSignal?.aborted) streamError = (part as any).error;
    }
  }

  // Release text held back while waiting to see if it was the start of a <think> tag
  const leftover = inlineFilter.flush();
  if (leftover) {
    fullAssistantText += leftover;
    if (onContentChunk) onContentChunk(leftover);
    else process.stdout.write(leftover);
  }

  if (!abortSignal?.aborted && stepCount >= maxSteps && lastFinishReason === "tool-calls") {
    console.log(
      chalk.yellow(`\n[Step limit] Stopped after ${stepCount} tool steps. Say "continue" to keep going.`)
    );
  }

  // Clean up any remaining thinking state
  if (hasStartedNativeReasoning || inlineFilter.isInThink()) {
    reasoningManager.endThinking();
  }

  if (streamError !== undefined && !abortSignal?.aborted) {
    const message = errorMessage(streamError);
    // Nothing usable came back: fail the turn so callers can clean up and set an exit code.
    if (!fullAssistantText.trim() && !toolRecords?.length) throw new Error(message);
    // Partial work (text or tools that already ran) is kept so it gets saved.
    console.error(chalk.red(`\nStream Error: ${message}`));
  }

  return fullAssistantText;
}
