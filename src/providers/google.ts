import { getTools } from "../tools/index.js";
import { GoogleGenAI } from "@google/genai";
import { AskGptConfig, ChatMessage } from "../types.js";
import { ReasoningManager } from "../reasoning.js";

function toJsonSchema(s: any) {
  if (s?.jsonSchema) return s.jsonSchema;            // AI SDK jsonSchema() wrapper
  if (s && typeof s === "object" && s.type) return s; // already plain JSON Schema
  return { type: "object", properties: {} };          // fallback so Gemini never gets undefined
}


export async function streamGoogleChat({
  config,
  messages,
  systemPrompt,
  reasoningManager,
  onContentChunk,
  abortSignal
  }: {
    config: AskGptConfig;
    messages: ChatMessage[];
    systemPrompt?: string;
    reasoningManager: ReasoningManager;
    onContentChunk: (chunk: string) => void;
    abortSignal?: AbortSignal;
  }): Promise<string> {
    const ai = new GoogleGenAI({
    apiKey: config.apiKey || process.env.GEMINI_API_KEY
  });

  // Map your harness message history (including multimodal parts built by buildUserMessage)
  const formattedContents = messages.map(msg => {
    if (Array.isArray(msg.content)) {
      const parts = msg.content.map((item: any) => {
        if (item.type === "text") {
          return { text: item.text };
        } else if (item.type === "image") {
          return {
            inlineData: {
              mimeType: item.mediaType,
              data: Buffer.isBuffer(item.image) ? item.image.toString("base64") : item.image
            }
          };
        }
        return { text: String(item) };
      });
      return { role: msg.role === "assistant" ? "model" : "user", parts };
    }

    return {
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    };
  });

  const tools = await getTools({
    autoApprove: config.autoApproveTools,
    provider: config.provider,
  });

  const functionDeclarations = Object.entries(tools).map(([name, t]: any) => ({
    name,
    description: t.description,
    parametersJsonSchema: toJsonSchema(t.inputSchema ?? t.parameters),
  }));

  const contents: any[] = [...formattedContents];
  let fullText = "";

  for (let step = 0; step < 10; step++) {
    const stream = await ai.models.generateContentStream({
      model: config.model || "gemini-3.5-flash-lite",
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }],
        abortSignal,
        thinkingConfig: { includeThoughts: true },
      },
    });

    const modelParts: any[] = [];
    const calls: any[] = [];

    let inThought = false;

    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part);

        if (part.text && part.thought) {
          if (!inThought) {
            reasoningManager.startThinking();
            inThought = true;
          }
          reasoningManager.handleThinkingChunk(part.text);
        } else {
          // first non-thought part closes the thinking block
          if (inThought) {
            reasoningManager.endThinking();
            inThought = false;
          }
          if (part.text) {
            fullText += part.text;
            onContentChunk(part.text);
          }
        }

        if (part.functionCall) calls.push(part.functionCall);
      }
    }

    if (inThought) {
      reasoningManager.endThinking();
      inThought = false;
    }

    if (calls.length === 0) break;

    // push the model's parts back untouched (Gemini 3 needs thoughtSignature preserved)
    contents.push({ role: "model", parts: modelParts });

    const responses: any[] = [];
    for (const call of calls) {
      let result: any;
      try {
        result = await (tools as any)[call.name].execute(call.args, {
          toolCallId: call.id ?? call.name,
          messages: [],
        });
      } catch (e: any) {
        result = { error: e.message };
      }
      responses.push({
        functionResponse: { name: call.name, response: { result } },
      });
    }
    contents.push({ role: "user", parts: responses });
  }

  return fullText;
}
