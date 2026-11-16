// src/argue.ts
// The /argue command of the REPL:
//   /argue <your defense>   Dispute the assistant's last answer. Your short
//                           reply is expanded by a separate, stateless call
//                           (no history, no tools, no persona) into a full
//                           argument, which is then sent as your next message.
import chalk from "chalk";

/** What /argue needs from the REPL. */
export interface ArgueHost {
  /** The current conversation (same shape the REPL keeps in .context.json). */
  getMessages(): { role: string; content: any }[];
  /** One stateless call: no history, no tools, no system prompt. Returns the text. */
  oneShot(prompt: string): Promise<string>;
  /** Optional: names of the tools the main model can use (lets the expander point at a different one). */
  getToolNames?(): Promise<string[]>;
}

/** Plain text of a message; tool-call / tool-result parts are ignored. */
export function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

/** The last question the user asked and the assistant's text answer to it. */
export function lastExchange(
  messages: { role: string; content: any }[]
): { question: string; answer: string } | null {
  let answer = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = textOf(messages[i].content).trim();
    if (!text) continue;
    if (!answer && messages[i].role === "assistant") answer = text;
    else if (answer && messages[i].role === "user") return { question: text, answer };
  }
  return null;
}

export function buildArguePrompt(
  question: string,
  answer: string,
  argument: string,
  tools: string[] = []
): string {
  return (
    `This is the initial question the user said: ${question}\n\n` +
    `The assistant said: ${answer}\n\n` +
    `The user wants to argue that: ${argument}\n\n` +
    `Expand this argument to make sure the assistant knows what the user is implying. ` +
    `If the assistant's answer rested on a failed search or lookup, point out that finding nothing is not proof something doesn't exist. ` +
    (tools.length
      ? `The assistant has these tools: ${tools.join(", ")}. Tell it to try a different tool from this list instead of repeating the one it already used. `
      : `Tell it to try a different method than the one it already used. `) +
    `Do not add facts the user did not state or imply. ` +
    `Only return the expanded response; don't use any personality traits.`
  );
}

/** Runs /argue. Returns the message to send to the model, or null if nothing should be sent. */
export async function runArgue(args: string, host: ArgueHost): Promise<string | null> {
  const argument = args.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  if (!argument) {
    console.log(chalk.bold("\nUsage:"));
    console.log(`  ${chalk.cyan('/argue "But it does."')}   Dispute the assistant's last answer; your reply is expanded into a full argument first\n`);
    return null;
  }

  const last = lastExchange(host.getMessages());
  if (!last) {
    console.log(chalk.yellow("Nothing to argue with yet. Ask something first."));
    return null;
  }

  try {
    console.log(chalk.gray("Expanding your argument..."));
    const tools = host.getToolNames ? await host.getToolNames().catch(() => [] as string[]) : [];
    const expanded = (await host.oneShot(buildArguePrompt(last.question, last.answer, argument, tools))).trim();
    if (!expanded) {
      console.log(chalk.yellow("The expander returned nothing; sending your text as-is."));
      return argument;
    }
    console.log(chalk.gray("\nSending:"));
    console.log(chalk.dim(expanded) + "\n");
    return expanded;
  } catch (err: any) {
    console.error(chalk.red(`/argue failed: ${err?.message ?? String(err)}`));
    return null;
  }
}
