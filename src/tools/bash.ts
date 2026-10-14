// src/tools/bash.ts
import { exec } from "child_process";
import chalk from "chalk";
import { confirmTool, rejectionMessage } from "./confirm.js";

export interface BashOptions {
  autoApprove?: boolean;
}

export async function executeBash(
  command: string,
  explanation?: string,
  options: BashOptions = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const trimmed = (command || "").trim();
  if (!trimmed) {
    return {
      stdout: "",
      stderr: "Error: No command was provided to execute.",
      exitCode: 1
    };
  }

  const showPlan = () => {
    if (explanation) {
      console.log(chalk.cyan(`[Command Planned]: ${explanation}`));
    }
    console.log(chalk.yellow(`$ ${trimmed}`));
  };

  if (options.autoApprove) {
    console.log();
    showPlan();
  } else {
    const verdict = await confirmTool({
      question: "Run this command?",
      preview: showPlan
    });
    if (!verdict.approved) {
      return {
        stdout: "",
        stderr: rejectionMessage(verdict, "command"),
        exitCode: 1
      };
    }
  }

  return new Promise((resolve) => {
    exec(trimmed, { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || (err ? err.message : ""),
        // err.code can be a string (e.g. maxBuffer exceeded), which used to read as exit 0
        exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0
      });
    });
  });
}
