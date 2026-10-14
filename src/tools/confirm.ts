// src/tools/confirm.ts
// One approval prompt for every tool that needs confirmation.
//   y           -> approve
//   n / Enter   -> reject
//   Tab (or r)  -> reject, then type a reason (Enter sends, Esc skips)
// Single keypresses only (no readline), so it can't fight the REPL's
// raw-mode keypress listener while the model is streaming.

import readline from "readline";
import chalk from "chalk";

export interface Verdict {
  approved: boolean;
  reason?: string;
  noTty?: boolean;
}

function askVerdict(prompt: string): Promise<Verdict> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    readline.emitKeypressEvents(stdin);

    // REPL: raw mode is already on while the model streams.
    // One-shot: it isn't, so turn it on and restore it afterwards.
    const wasRaw = Boolean(stdin.isRaw);
    if (!wasRaw) {
      stdin.setRawMode(true);
      stdin.resume();
    }

    let mode: "key" | "reason" = "key";
    let buf = "";

    const finish = (v: Verdict) => {
      stdin.removeListener("keypress", onKey);
      if (!wasRaw) {
        stdin.setRawMode(false);
        stdin.pause();
      }
      process.stdout.write("\n");
      resolve(v);
    };

    const onKey = (str: string, key: any) => {
      const name = key?.name;

      if (key?.ctrl && name === "c") {
        finish({ approved: false, reason: "User interrupted" });
        if (!wasRaw) process.exit(130); // raw mode swallows SIGINT in one-shot mode
        return;
      }

      if (mode === "key") {
        const ch = (str || "").toLowerCase();
        if (ch === "y") return finish({ approved: true });
        if (name === "tab" || ch === "r") {
          mode = "reason";
          process.stdout.write(chalk.yellow("\nWhy? "));
          return;
        }
        if (ch === "n" || name === "return" || name === "enter" || name === "escape") {
          return finish({ approved: false });
        }
        return;
      }

      // mode === "reason"
      if (name === "return" || name === "enter") {
        return finish({ approved: false, reason: buf.trim() || undefined });
      }
      if (name === "escape") return finish({ approved: false });
      if (name === "backspace") {
        if (buf.length) {
          buf = buf.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (str && !key?.ctrl && !key?.meta && str.charCodeAt(0) >= 32) {
        buf += str;
        process.stdout.write(str);
      }
    };

    stdin.on("keypress", onKey);
    process.stdout.write(prompt);
  });
}

// The model can emit several tool calls in one step and the SDK runs them
// concurrently. This queue makes sure only one prompt is on screen at a time,
// and that each tool's preview prints right before its own prompt.
let lock: Promise<unknown> = Promise.resolve();

export function confirmTool(opts: {
  question: string;          // e.g. "Run this command?" / "Apply to src/a.ts?"
  preview?: () => void;      // prints the command / diff, runs inside the queue
  autoApprove?: boolean;     // --yolo: skip everything, caller prints its own summary
}): Promise<Verdict> {
  if (opts.autoApprove) return Promise.resolve({ approved: true });

  const run = lock.then(async (): Promise<Verdict> => {
    process.stdout.write("\n");
    opts.preview?.();
    if (!process.stdin.isTTY) return { approved: false, noTty: true };
    return askVerdict(
      chalk.bold(`\n${opts.question} [y/N] `) + chalk.dim("(on reject, press Tab to say why) ")
    );
  });
  lock = run.catch(() => {});
  return run;
}

// Text handed back to the model when a tool is rejected.
export function rejectionMessage(v: Verdict, what: string = "action"): string {
  if (v.noTty) {
    return `This ${what} needs user approval but there is no interactive terminal. Tell the user to run with --yolo.`;
  }
  return (
    `User rejected this ${what}.` +
    (v.reason ? ` Reason: ${v.reason}` : " No reason given.") +
    ` Do not retry the same ${what} unchanged; adjust your approach or ask the user.`
  );
}
