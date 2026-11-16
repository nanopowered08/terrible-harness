export type ProviderType = "groq" | "openai" | "anthropic" | "ollama" | "google" | "custom";

export interface CustomApiConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  payloadTemplate: Record<string, any>;
  responsePath?: string;
  reasoningPath?: string;
}

/** Optional image model for the generate_image tool. The tool only exists when this is set. */
export interface ImageGenerationConfig {
  /** "google" = Gemini generateContent (Nano Banana etc.), "openai" = /images/generations (OpenAI-compatible). */
  provider: "google" | "openai";
  model: string;
  /** Falls back to IMAGE_API_KEY, then the provider's usual env var. */
  apiKey?: string;
  /** Falls back to the provider's public endpoint. */
  baseURL?: string;
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
  /** Passed straight to the AI SDK as providerOptions, e.g. { "google": { "thinkingConfig": { "includeThoughts": true } } } */
  providerOptions?: Record<string, Record<string, any>>;
  autoApproveTools?: boolean;
  /** Hard cap on tool-calling steps per turn (default 50). */
  maxSteps?: number;
  aiComment?: boolean;
  /** MCP servers to connect to; their tools show up next to the built-in tools. */
  mcpServers?: Record<string, McpServerConfig>;
  /** Image model for the generate_image tool (saves into ./images). Leave out to disable the tool. */
  imageGeneration?: ImageGenerationConfig;
}

export interface McpServerConfig {
  // stdio server (spawned locally)
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** "inherit" shows the server's stderr in your terminal (default: hidden). */
  stderr?: "inherit" | "ignore";
  // remote server
  url?: string;
  type?: "http" | "sse";
  headers?: Record<string, string>;
  /** Skip the approval prompt for this server's tools. */
  autoApprove?: boolean;
  disabled?: boolean;
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
