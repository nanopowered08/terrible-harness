export type ProviderType = "groq" | "openai" | "anthropic" | "ollama" | "custom";

export interface CustomApiConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  payloadTemplate: Record<string, any>;
  responsePath?: string;
  reasoningPath?: string;
}

export interface AskGptConfig {
  provider: ProviderType;
  model: string;
  apiKey?: string;
  baseURL?: string;
  thinking?: {
    defaultVisible?: boolean;
    reasoningPath?: string;
  };
  custom?: CustomApiConfig;
  autoApproveTools?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: any[];
  toolResults?: any[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any) => Promise<string | object>;
}
