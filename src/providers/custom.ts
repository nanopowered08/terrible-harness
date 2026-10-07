import { AskGptConfig, ChatMessage } from "../types.js";
import { ReasoningManager } from "../reasoning.js";

export function getNestedValue(obj: any, path: string): any {
  if (!path || !obj) return obj;
  // Convert array brackets choices[0] to choices.0
  const normalized = path.replace(/\[(\w+)\]/g, ".$1");
  const parts = normalized.split(".");
  let curr = obj;
  for (const part of parts) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[part];
  }
  return curr;
}

export function populateTemplate(template: any, variables: Record<string, any>): any {
  if (typeof template === "string") {
    let result = template;
    for (const [key, val] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      if (result === placeholder && typeof val !== "string") {
        return val;
      }
      if (typeof val === "string") {
        result = result.replaceAll(placeholder, val);
      } else {
        result = result.replaceAll(placeholder, JSON.stringify(val));
      }
    }
    return result;
  }

  if (Array.isArray(template)) {
    return template.map((item) => populateTemplate(item, variables));
  }

  if (template !== null && typeof template === "object") {
    const output: Record<string, any> = {};
    for (const [k, v] of Object.entries(template)) {
      output[k] = populateTemplate(v, variables);
    }
    return output;
  }

  return template;
}

export async function executeCustomApi(
  config: AskGptConfig,
  messages: ChatMessage[],
  systemPrompt: string | null,
  reasoningManager: ReasoningManager,
  onContentChunk: (chunk: string) => void
): Promise<string> {
  const custom = config.custom;
  if (!custom || !custom.url) {
    throw new Error("Custom provider requires 'custom.url' in config.json");
  }

  const lastMessage = messages[messages.length - 1];
  const prompt = lastMessage ? lastMessage.content : "";

  const variables: Record<string, any> = {
    prompt,
    messages,
    system: systemPrompt || "",
    model: config.model
  };

  const payload = populateTemplate(custom.payloadTemplate || { prompt: "{{prompt}}" }, variables);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(custom.headers || {})
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(custom.url, {
    method: custom.method || "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Custom API returned ${res.status}: ${errorText}`);
  }

  // Check if response is stream or JSON
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    const content = getNestedValue(data, custom.responsePath || "choices.0.message.content") ||
                    getNestedValue(data, "content") ||
                    getNestedValue(data, "response") ||
                    getNestedValue(data, "text") ||
                    JSON.stringify(data);

    if (custom.reasoningPath) {
      const reasoning = getNestedValue(data, custom.reasoningPath);
      if (reasoning) {
        reasoningManager.startThinking();
        reasoningManager.handleThinkingChunk(String(reasoning));
        reasoningManager.endThinking();
      }
    }

    onContentChunk(String(content));
    return String(content);
  } else {
    // Read text stream
    const text = await res.text();
    onContentChunk(text);
    return text;
  }
}
