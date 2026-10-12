import { GoogleGenAI } from "@google/genai";
import { AskGptConfig, ChatMessage } from "../types.js";
import { ReasoningManager } from "../reasoning.js";

export async function streamGoogleChat({
  config,
  messages,
  systemPrompt,
  reasoningManager,
  onContentChunk
}: {
  config: AskGptConfig;
  messages: ChatMessage[];
  systemPrompt?: string;
  reasoningManager: ReasoningManager;
  onContentChunk: (chunk: string) => void;
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

  const responseStream = await ai.models.generateContentStream({
    model: config.model || "gemini-3.5-flash-lite",
    contents: formattedContents,
    config: {
      systemInstruction: systemPrompt,
    }
  });

  let fullText = "";
  for await (const chunk of responseStream) {
    if (chunk.text) {
      fullText += chunk.text;
      onContentChunk(chunk.text);
    }
  }

  return fullText;
}