/**
 * StagedSummarize.ts   (put it in src/, next to repl.ts)
 *
 * Another STAGE file, same idea as the old StagedPatches.ts (now Guards.ts): the helper code below is
 * real, and the PATCH comments at the bottom say where in src/repl.ts each
 * piece goes. Nothing edits your files automatically.
 *
 * What it adds:
 *  1) Summarize instead of trim. When the context reaches 75% of the model's
 *     window, one one-shot call (its own summarizer system prompt, the whole
 *     context fed in) produces a summary, and the summary replaces the
 *     context. Your real system prompt is never touched. It is sent
 *     separately on every turn, exactly as before.
 *  2) A global system prompt: ~/.terrible-harness/.system.txt, used when the
 *     local .system.txt is missing, or forced with "/system global".
 *
 * Import style: "./StagedSummarize.js" (ESM/tsup), same as your other imports.
 */

import fs from "fs";
import os from "os";
import path from "path";
import chalk from "chalk";
import { generateText } from "ai";
import { getModel } from "./providers/ai-sdk.js";
import { AskGptConfig, ChatMessage } from "./types.js";

// ---------------------------------------------------------------------------
// Context window + token estimate
// ---------------------------------------------------------------------------

export const SUMMARY_THRESHOLD = 0.75;
const TOOL_OVERHEAD_TOKENS = 1500; // rough cost of the 4 tool definitions
const DEFAULT_CONTEXT_WINDOW = 32768;

// Rough defaults by model name. For the real number, add
//   "contextWindow": 131072
// to ~/.terrible-harness/config.json (read below via config.contextWindow).
const KNOWN_WINDOWS: [string, number][] = [
  ["gpt-oss", 131072],
  ["qwen", 131072],
  ["llama", 131072],
  ["claude", 200000],
  ["gpt-4", 128000],
];

export function getContextWindow(config: AskGptConfig): number {
  const override = (config as any).contextWindow;
  if (typeof override === "number" && override > 0) return override;
  const model = String(config.model).toLowerCase();
  for (const [key, size] of KNOWN_WINDOWS) {
    if (model.includes(key)) return size;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => {
        if (typeof p === "string") return p;
        if (p?.type === "text") return p.text ?? "";
        if (p?.type === "image") return "[image]";
        return JSON.stringify(p);
      })
      .join("\n");
  }
  return JSON.stringify(content ?? "");
}

/** chars / 4, plus the system prompt, tool definitions and the pending message. */
export function estimateTokens(
  messages: ChatMessage[],
  systemPrompt: string | null,
  pendingText = ""
): number {
  let chars = (systemPrompt?.length ?? 0) + pendingText.length;
  for (const m of messages) chars += contentToText(m.content).length + 16;
  return Math.ceil(chars / 4) + TOOL_OVERHEAD_TOKENS;
}

// ---------------------------------------------------------------------------
// The summarizer (one-shot call, no tools, no streaming)
// ---------------------------------------------------------------------------

export const SUMMARIZER_SYSTEM_PROMPT = `You are a conversation summarizer running as a one-shot task. The user message contains a SYSTEM PROMPT block and a CONVERSATION TRANSCRIPT block.

Summarize the transcript so the conversation can continue from your summary alone.

Rules:
- The system prompt is shown for reference only. It stays in place unchanged and is not part of the conversation. Keep it intact: never rewrite it, repeat it, or summarize it.
- Keep: the user's goals, decisions and preferences, important facts (names, paths, commands, code, file contents that matter, errors and their fixes), what has been done, and what is still pending.
- Drop: small talk, repetition, and roleplay or persona flavor. Write plain facts in a neutral voice.
- Do not invent anything that is not in the transcript.
- Output only the summary: short paragraphs or bullet points, under about 800 words.`;

export interface SummarizeOptions {
  config: AskGptConfig;
  context: ChatMessage[]; // mutated in place on success
  systemPrompt: string | null;
  backupPath?: string; // the old context is saved here before it is replaced
  abortSignal?: AbortSignal;
}

/** Returns true if the context was replaced by a summary. */
export async function summarizeContext(opts: SummarizeOptions): Promise<boolean> {
  const { config, context, systemPrompt, abortSignal } = opts;
  const backupPath = opts.backupPath ?? ".context.backup.json";
  if (context.length === 0) return false;

  const transcript = context
    .map((m) => `${String(m.role).toUpperCase()}: ${contentToText(m.content)}`)
    .join("\n\n");

  const prompt =
    `[SYSTEM PROMPT - reference only, keep intact]\n${systemPrompt ?? "(none)"}\n[END SYSTEM PROMPT]\n\n` +
    `[CONVERSATION TRANSCRIPT]\n${transcript}\n[END TRANSCRIPT]\n\nSummarize the transcript now.`;

  // Safety net: keep the full old context on disk.
  fs.writeFileSync(backupPath, JSON.stringify(context, null, 2));

  const result = await generateText({
    model: getModel(config),
    system: SUMMARIZER_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: 2000,
    abortSignal,
  });

  // Reasoning models may put <think> blocks in the text.
  const summary = result.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!summary) return false;

  context.length = 0;
  context.push(
    { role: "user", content: `[Summary of the earlier conversation]\n${summary}` } as ChatMessage,
    { role: "assistant", content: "Understood. Continuing from that summary." } as ChatMessage
  );
  return true;
}

export interface MaybeSummarizeOptions {
  config: AskGptConfig;
  context: ChatMessage[];
  systemPrompt: string | null;
  pendingText?: string; // the user message about to be sent
  save: (context: ChatMessage[]) => void; // pass saveContext from context.ts
  force?: boolean; // true for the /summarize command
}

/**
 * Checks the 75% threshold (or force) and summarizes. Never throws: if the
 * summary call fails (rate limit, network), the old context is kept as is.
 */
export async function maybeSummarize(opts: MaybeSummarizeOptions): Promise<boolean> {
  const { config, context, systemPrompt, pendingText = "", save, force = false } = opts;

  const windowSize = getContextWindow(config);
  const tokens = estimateTokens(context, systemPrompt, pendingText);
  const ratio = tokens / windowSize;

  if (!force && ratio < SUMMARY_THRESHOLD) return false;
  if (context.length === 0) {
    if (force) console.log(chalk.yellow("Nothing to summarize yet."));
    return false;
  }

  console.log(
    chalk.dim(
      `[Context ~${tokens} tokens (${Math.round(ratio * 100)}% of ${windowSize}). Summarizing...]`
    )
  );

  try {
    const ok = await summarizeContext({ config, context, systemPrompt });
    if (!ok) {
      console.log(chalk.yellow("[Summary came back empty, keeping the full context]\n"));
      return false;
    }
    save(context);
    const after = estimateTokens(context, systemPrompt, pendingText);
    console.log(chalk.green(`[Context summarized: ~${tokens} -> ~${after} tokens. Old copy: .context.backup.json]\n`));
    return true;
  } catch (err: any) {
    console.log(chalk.yellow(`[Summarizing failed (${err?.message ?? err}), keeping the full context]\n`));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Global system prompt: ~/.terrible-harness/.system.txt
// ---------------------------------------------------------------------------

export const GLOBAL_SYSTEM_FILE = path.join(os.homedir(), ".terrible-harness", ".system.txt");

export function loadGlobalSystemPrompt(): string | null {
  try {
    const text = fs.readFileSync(GLOBAL_SYSTEM_FILE, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Default: the local .system.txt wins, the global file is the fallback.
 * preferGlobal (set by "/system global"): the global file wins instead.
 */
export function resolveSystemPrompt(local: string | null, preferGlobal = false): string | null {
  const global = loadGlobalSystemPrompt();
  return preferGlobal ? (global ?? local) : (local ?? global);
}

// ---------------------------------------------------------------------------
// PATCH 1: imports in src/repl.ts
// Where: top of the file, after the line
//   import { createTurnGuard, createInterrupt, isAbortError } from "./Guards.js";
// Add:
//   import { maybeSummarize, resolveSystemPrompt, GLOBAL_SYSTEM_FILE } from "./StagedSummarize.js";
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 2: system prompt loading (global fallback)
// Where: the line
//   let systemPrompt = loadSystemPrompt();
// Change to:
//   let preferGlobal = false;
//   let systemPrompt = resolveSystemPrompt(loadSystemPrompt(), preferGlobal);
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 3: /system commands
// Where: in handleSlashCommand, the existing block
//   if (trimmed === "/system") {
//     systemPrompt = loadSystemPrompt();
// Change that second line to:
//     systemPrompt = resolveSystemPrompt(loadSystemPrompt(), preferGlobal);
// Then add this new block right BEFORE `if (trimmed === "/system") {`:
//   if (trimmed === "/system global" || trimmed === "/system local") {
//     preferGlobal = trimmed === "/system global";
//     systemPrompt = resolveSystemPrompt(loadSystemPrompt(), preferGlobal);
//     console.log(chalk.green(
//       preferGlobal
//         ? `System prompt source: ${GLOBAL_SYSTEM_FILE}`
//         : `System prompt source: local ${SYSTEM_FILE} (global file as fallback)`
//     ));
//     return true;
//   }
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 4: /summarize command (manual trigger, also good for testing)
// Where: in handleSlashCommand, right BEFORE the block
//   if (trimmed === "/exit" || trimmed === "/quit") {
// Add:
//   if (trimmed === "/summarize") {
//     await maybeSummarize({ config, context, systemPrompt, save: saveContext, force: true });
//     return true;
//   }
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 5: automatic check before every turn (the 75% rule)
// Where: in handleLine, right BEFORE the line
//   context.push({ role: "user", content: msg.stored });
// Add:
//   await maybeSummarize({ config, context, systemPrompt, pendingText: input, save: saveContext });
// It runs before the new message is pushed, so the new message goes after the
// summary. It sits inside the turn guard from Guards.ts, so stray
// input is dropped while it runs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 6: /help entries
// Where: in the /help block, after the line that prints "/model"
// Add:
//   console.log(`  ${chalk.cyan("/summarize")}                 Summarize the context now (auto at 75% of the window)`);
//   console.log(`  ${chalk.cyan("/system global|local")}       Prefer ~/.terrible-harness/.system.txt or the local .system.txt`);
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 7 (optional): exact context window for your model
// Where: ~/.terrible-harness/config.json
//   add:   "contextWindow": 131072
// Only works if your config loader keeps unknown keys. If it strips them, add
// `contextWindow?: number;` to AskGptConfig in src/types.ts and make the loader
// copy it through. Without it, the name-based table above is used.
// ---------------------------------------------------------------------------
