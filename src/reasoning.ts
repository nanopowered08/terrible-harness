import chalk from "chalk";
import { saveReasoning } from "./context.js";

export class ReasoningManager {
  private buffer: string = "";
  private isVisible: boolean;
  private hasFlushedBuffer: boolean = false;
  private modelName: string;
  private activeThinking: boolean = false;

  constructor(defaultVisible: boolean = false, modelName: string = "unknown") {
    this.isVisible = defaultVisible;
    this.modelName = modelName;
  }

  public getVisible(): boolean {
    return this.isVisible;
  }

  public setVisible(val: boolean): void {
    if (this.isVisible === val) return;
    this.isVisible = val;
    if (this.isVisible && !this.hasFlushedBuffer && this.buffer.length > 0) {
      this.flushBufferedThoughts();
    }
  }

  public toggle(): boolean {
    this.setVisible(!this.isVisible);
    return this.isVisible;
  }

  public startThinking(): void {
    if (this.activeThinking) return;
    this.activeThinking = true;
    if (this.isVisible) {
      process.stdout.write(chalk.dim.magenta("╭─ Thinking ────────────────────────────────────────\n│ "));
    } else {
      process.stdout.write(chalk.dim.italic("[Thinking in progress... Press Ctrl+T to reveal]\r"));
    }
  }

  public handleThinkingChunk(chunk: string): void {
    this.buffer += chunk;
    if (this.isVisible) {
      // Format lines with thinking styling
      const formatted = chunk.replace(/\n/g, "\n│ ");
      process.stdout.write(chalk.dim.italic(formatted));
    }
  }

  public flushBufferedThoughts(): void {
    this.hasFlushedBuffer = true;
    // Clear the "[Thinking in progress...]" line
    process.stdout.write("\r\x1b[K");
    process.stdout.write(chalk.dim.magenta("╭─ Thinking (Revealed) ─────────────────────────────\n│ "));
    const formatted = this.buffer.replace(/\n/g, "\n│ ");
    process.stdout.write(chalk.dim.italic(formatted));
  }

  public endThinking(): void {
    if (!this.activeThinking) return;

    if (this.isVisible) {
      process.stdout.write(chalk.dim.magenta("\n╰───────────────────────────────────────────────────\n\n"));
    } else {
      // Clear indicator
      process.stdout.write("\r\x1b[K");
    }

    // Always persist reasoning trace to .reasoning.json
    if (this.buffer.trim().length > 0) {
      saveReasoning(this.buffer, this.modelName);
    }

    this.activeThinking = false;
  }

  public getReasoning(): string {
    return this.buffer;
  }
}

/**
 * Helper to parse inline <think> tags if the model outputs thinking in content.
 */
export class InlineThinkFilter {
  private inThinkTag: boolean = false;
  private pending: string = ""; // a possible half-received <think> / </think> tag
  private onThinkChunk: (chunk: string) => void;
  private onThinkStart: () => void;
  private onThinkEnd: () => void;

  constructor(
    onThinkChunk: (chunk: string) => void,
    onThinkStart: () => void,
    onThinkEnd: () => void
  ) {
    this.onThinkChunk = onThinkChunk;
    this.onThinkStart = onThinkStart;
    this.onThinkEnd = onThinkEnd;
  }

  /** Length of the longest tail of `text` that is a proper prefix of `tag`. */
  private partialTagLength(text: string, tag: string): number {
    const max = Math.min(text.length, tag.length - 1);
    for (let len = max; len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }

  public process(incoming: string): string {
    if (!incoming || typeof incoming !== "string") return "";
    const text = this.pending + incoming;
    this.pending = "";
    let result = "";
    let i = 0;

    while (i < text.length) {
      if (!this.inThinkTag) {
        const startIdx = text.indexOf("<think>", i);
        if (startIdx === -1) {
          const hold = this.partialTagLength(text.slice(i), "<think>");
          result += text.slice(i, text.length - hold);
          this.pending = text.slice(text.length - hold);
          break;
        }
        result += text.slice(i, startIdx);
        this.inThinkTag = true;
        this.onThinkStart();
        i = startIdx + "<think>".length;
      } else {
        const endIdx = text.indexOf("</think>", i);
        if (endIdx === -1) {
          const hold = this.partialTagLength(text.slice(i), "</think>");
          const chunk = text.slice(i, text.length - hold);
          if (chunk) this.onThinkChunk(chunk);
          this.pending = text.slice(text.length - hold);
          break;
        }
        const chunk = text.slice(i, endIdx);
        if (chunk) this.onThinkChunk(chunk);
        this.inThinkTag = false;
        this.onThinkEnd();
        i = endIdx + "</think>".length;
      }
    }

    return result;
  }

  /** Call once when the stream ends: releases text held back as a possible tag. */
  public flush(): string {
    const rest = this.pending;
    this.pending = "";
    if (!rest) return "";
    if (this.inThinkTag) {
      this.onThinkChunk(rest);
      return "";
    }
    return rest;
  }

  public isInThink(): boolean {
    return this.inThinkTag;
  }
}
