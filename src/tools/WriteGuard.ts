// src/tools/writeGuard.ts
// Diff preview + approval + backup for write_file.
// Needs: npm i diff   (pin the version npm gives you; v8+ ships its own types,
// older versions need @types/diff)

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { structuredPatch } from "diff";
import { writeFile } from "./files.js";
import { confirmTool, rejectionMessage } from "./confirm.js";
import { checkRead, noteContent } from "./ReadTracker.js";

const BACKUP_DIR = ".terrible-harness-backups"; // add this to your .gitignore
const MAX_PREVIEW_LINES = 120;
const MAX_ECHO_CHARS = 4000; // how much of the on-disk file to hand back on rejection

export interface GuardedWriteResult {
  success: boolean;
  bytesWritten?: number;
  error?: string;
  rejected?: boolean;
  unchanged?: boolean;
  needsRead?: boolean;
  backup?: string;
}

function renderDiff(
  rel: string,
  oldText: string | null,
  finalText: string,
  quiet: boolean
): { added: number; removed: number } {
  const out = quiet ? () => {} : (s: string) => console.log(s);

  if (oldText === null) {
    const lines = finalText.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop(); // trailing newline isn't a line
    out(chalk.bold(`--- new file: ${rel} (${lines.length} lines)`));
    for (const l of lines.slice(0, MAX_PREVIEW_LINES)) out(chalk.green("+" + l));
    if (lines.length > MAX_PREVIEW_LINES) {
      out(chalk.dim(`... ${lines.length - MAX_PREVIEW_LINES} more lines`));
    }
    return { added: lines.length, removed: 0 };
  }

  const patch = structuredPatch(rel, rel, oldText, finalText, "", "", { context: 3 });
  let added = 0;
  let removed = 0;
  let shown = 0;
  out(chalk.bold(`--- ${rel}`));
  for (const h of patch.hunks) {
    if (shown < MAX_PREVIEW_LINES) {
      out(chalk.cyan(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`));
    }
    for (const l of h.lines) {
      if (l.startsWith("+")) added++;
      else if (l.startsWith("-")) removed++;
      if (shown >= MAX_PREVIEW_LINES) continue;
      shown++;
      out(l.startsWith("+") ? chalk.green(l) : l.startsWith("-") ? chalk.red(l) : chalk.dim(l));
    }
  }
  if (shown >= MAX_PREVIEW_LINES) out(chalk.dim("... diff truncated"));
  return { added, removed };
}

function backupFile(rel: string, oldText: string): string | undefined {
  try {
    const dir = path.resolve(process.cwd(), BACKUP_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(dir, `${stamp}__${rel.replace(/[\\/]/g, "__")}`);
    fs.writeFileSync(dest, oldText, "utf-8");
    return path.relative(process.cwd(), dest);
  } catch {
    return undefined; // a failed backup shouldn't block the write
  }
}

export async function guardedWrite(
  filePath: string,
  content: string,
  append: boolean,
  opts: { autoApprove?: boolean } = {}
): Promise<GuardedWriteResult> {
  const fullPath = path.resolve(process.cwd(), filePath);
  const rel = path.relative(process.cwd(), fullPath) || filePath;

  let oldText: string | null = null;
  try {
    if (fs.existsSync(fullPath)) {
      if (fs.statSync(fullPath).isDirectory()) {
        return { success: false, error: `${filePath} is a directory, not a file.` };
      }
      oldText = fs.readFileSync(fullPath, "utf-8");
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }

  // Overwriting a file the model never read (or that changed since) is how
  // stale-content loops start. Make it read first. Appends are exempt.
  if (!append && oldText !== null) {
    const status = checkRead(fullPath, oldText);
    if (status !== "ok") {
      return {
        success: false,
        needsRead: true,
        error:
          status === "unread"
            ? `You have not read ${rel} in this session, so write_file will not overwrite it. Call read_file on ${rel} first, then retry with the right content.`
            : `${rel} changed on disk since you last read it. Call read_file on ${rel} again, then retry with the right content.`
      };
    }
  }

  const finalText = append ? (oldText ?? "") + content : content;
  if (oldText !== null && oldText === finalText) {
    noteContent(fullPath, finalText);
    return { success: true, bytesWritten: 0, unchanged: true };
  }

  if (opts.autoApprove) {
    // --yolo: no prompt, one summary line so you can see what happened
    const { added, removed } = renderDiff(rel, oldText, finalText, true);
    console.log(chalk.dim(`\n[write_file] ${rel}  +${added} -${removed}`));
  } else {
    const verdict = await confirmTool({
      question: `Apply to ${rel}?`,
      preview: () => renderDiff(rel, oldText, finalText, false)
    });
    if (!verdict.approved) {
      // Tell the model what is really on disk so it stops reasoning from a
      // file state that never happened.
      let echo = "";
      if (oldText === null) {
        echo = `\nNo file was created: ${rel} does not exist.`;
      } else {
        const truncated = oldText.length > MAX_ECHO_CHARS;
        echo =
          `\n${rel} was NOT changed. Its current contents on disk are:\n` +
          "```\n" + oldText.slice(0, MAX_ECHO_CHARS) + "\n```" +
          (truncated ? "\n(truncated; use read_file to see the rest)" : "");
        if (!truncated) noteContent(fullPath, oldText);
      }
      return { success: false, rejected: true, error: rejectionMessage(verdict, "change") + echo };
    }
  }

  const backup = oldText !== null ? backupFile(rel, oldText) : undefined;
  const res = writeFile(filePath, content, append);
  if (res.success) noteContent(fullPath, finalText);
  return { ...res, backup };
}
