
import type { AskGptConfig } from "./types.js";
import { getNestedValue, populateTemplate } from "./providers/custom.js";

const FALLBACK = "The AI commentator has disconnected. The flag still did its job.";

export async function generateAiComment(
  config: AskGptConfig | null,
  systemPrompt: string,
  flag: string,
  syntax: string,
  status: number
): Promise<string> {
  if (!config) return FALLBACK;

  const prompt =
    `You are writing a comment for the user to see. ` +
    `They have just run the ${flag} flag and the syntax for the flag is ${syntax}. ` +
    `The flag exited with status ${status} and you must write a short comment about that.`;

  try {
    const signal = AbortSignal.timeout(8000);
    let response: Response;
    let result: string | undefined;

    if (config.provider === "google") {
      const key = config.apiKey || process.env.GEMINI_API_KEY;
      if (!key) return FALLBACK;

      const model = encodeURIComponent(config.model);
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 120, temperature: 0.7 }
          })
        }
      );
    } else if (config.provider === "anthropic") {
      const key = config.apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) return FALLBACK;

      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 120,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }]
        })
      });
    } else if (config.provider === "custom") {
      const custom = config.custom;
      if (!custom?.url) return FALLBACK;

      const payload = populateTemplate(
        custom.payloadTemplate || { prompt: "{{prompt}}" },
        {
          prompt,
          messages: [{ role: "user", content: prompt }],
          system: systemPrompt,
          model: config.model
        }
      );

      response = await fetch(custom.url, {
        method: custom.method || "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(custom.headers || {}),
          ...(config.apiKey
            ? { Authorization: `Bearer ${config.apiKey}` }
            : {})
        },
        body: JSON.stringify(payload)
      });
    } else {
      const key =
        config.apiKey ||
        (config.provider === "groq" ? process.env.GROQ_API_KEY :
         config.provider === "openai" ? process.env.OPENAI_API_KEY :
         undefined);

      if (config.provider !== "ollama" && !key) return FALLBACK;

      const baseURL =
        config.baseURL ||
        (config.provider === "groq"
          ? "https://api.groq.com/openai/v1"
          : config.provider === "ollama"
            ? "http://localhost:11434/v1"
            : "https://api.openai.com/v1");

      response = await fetch(
        `${baseURL.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: `Bearer ${key}` } : {})
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt }
            ],
            max_tokens: 120,
            temperature: 0.7
          })
        }
      );
    }

    // Any non-2xx status triggers the fallback.
    if (!response.ok) return FALLBACK;

    const data: any = await response.json();

    if (config.provider === "google") {
      result = data.candidates?.[0]?.content?.parts
        ?.map((part: any) => part.text || "")
        .join("");
    } else if (config.provider === "anthropic") {
      result = data.content
        ?.filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join("");
    } else if (config.provider === "custom") {
      result = getNestedValue(
        data,
        config.custom?.responsePath || "choices.0.message.content"
      ) ?? data.content ?? data.response ?? data.text;
    } else {
      result = data.choices?.[0]?.message?.content;
    }

    return typeof result === "string" && result.trim()
      ? result.trim()
      : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
