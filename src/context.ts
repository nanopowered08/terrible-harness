import fs from "fs";
import path from "path";
import chalk from "chalk";
import { ChatMessage } from "./types.js";

export const CONTEXT_FILE = ".context.json";
export const SYSTEM_FILE = ".system.txt";
export const REASONING_FILE = ".reasoning.json";

export function loadContext(filepath: string = CONTEXT_FILE): ChatMessage[] {
  const fullPath = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(fullPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(fullPath, "utf-8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (m) => m && typeof m === "object" && typeof m.role === "string" && typeof m.content === "string"
      );
    }
    return [];
  } catch (err: any) {
    console.error(chalk.yellow(`Warning: Could not parse ${filepath}: ${err.message}. Starting with empty context.`));
    return [];
  }
}

export function saveContext(messages: ChatMessage[], filepath: string = CONTEXT_FILE): void {
  const fullPath = path.resolve(process.cwd(), filepath);
  try {
    const cleanMessages = messages.map((m) => ({
      role: m.role,
      content: m.content
    }));
    fs.writeFileSync(fullPath, JSON.stringify(cleanMessages, null, 2), "utf-8");
  } catch (err: any) {
    console.error(chalk.red(`Failed to save ${filepath}: ${err.message}`));
  }
}

export function clearContext(filepath: string = CONTEXT_FILE): void {
  const fullPath = path.resolve(process.cwd(), filepath);
  if (fs.existsSync(fullPath)) {
    try {
      fs.writeFileSync(fullPath, "[]\n", "utf-8");
    } catch (err: any) {
      console.error(chalk.red(`Failed to clear ${filepath}: ${err.message}`));
    }
  }
}

export function loadSystemPrompt(filepath: string = SYSTEM_FILE): string | null {
  const fullPath = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(fullPath, "utf-8").trim();
    return content.length > 0 ? content : null;
  } catch (err: any) {
    console.error(chalk.yellow(`Warning: Could not read ${filepath}: ${err.message}`));
    return null;
  }
}

export function saveReasoning(
  reasoning: string,
  model?: string,
  filepath: string = REASONING_FILE
): void {
  const fullPath = path.resolve(process.cwd(), filepath);
  try {
    const data = {
      timestamp: new Date().toISOString(),
      model: model || "unknown",
      reasoning
    };
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err: any) {
    console.error(chalk.red(`Failed to save ${filepath}: ${err.message}`));
  }
}

export function loadReasoning(filepath: string = REASONING_FILE): { timestamp: string; model: string; reasoning: string } | null {
  const fullPath = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(fullPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
