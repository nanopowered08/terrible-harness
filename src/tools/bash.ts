import { exec } from "child_process";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";

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

  if (explanation) {
    console.log(chalk.cyan(`\n[Command Planned]: ${explanation}`));
  }
  console.log(chalk.yellow(`$ ${trimmed}`));

  if (!options.autoApprove) {
    if (!process.stdin.isTTY) {
      console.log(chalk.red("Command execution denied: interactive confirmation is not available in non-interactive session. Use --yolo to allow."));
      return {
        stdout: "",
        stderr: "Command execution denied: Confirmation unavailable in non-interactive session. Use --yolo to auto-approve.",
        exitCode: 1
      };
    }

    try {
      const ok = await confirm({
        message: "Authorize execution of this command?",
        default: true
      });
      if (!ok) {
        return {
          stdout: "",
          stderr: "Execution aborted by user.",
          exitCode: 1
        };
      }
    } catch {
      return {
        stdout: "",
        stderr: "Aborted (confirmation interrupted).",
        exitCode: 1
      };
    }
  }

  return new Promise((resolve) => {
    exec(trimmed, { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || (err ? err.message : ""),
        exitCode: err && typeof err.code === "number" ? err.code : 0
      });
    });
  });
}
