import {
  clearContext,
  loadSystemPrompt,
} from "./context.js";
import { executeOneShot } from "./execution/one-shot.js";
import { resolveInput } from "./execution/input.js";
import { generateAiComment } from "./ai-comment.js";
import { Command } from "commander"; import chalk from "chalk";
import { startRepl } from "./repl.js";
import { AskGptConfig, ChatMessage } from "./types.js";
import { initializeConfig } from "./execution/configuration.js";
import { loadConfig, saveConfig } from "./config.js";

(globalThis as any).AI_SDK_LOG_WARNINGS = false;


async function main() {
  const program = new Command();

  console.log(chalk.red(`!! ${chalk.blue(`This project is deprecated.`)} !!`)); 
  console.log(chalk.gray(`If you want to know why, go to https://github.com/nanopowered08/askgpt. `));

  program
    .name("terrible-harness")
    .description("The most terrible harness you've ever seen.")
    .version("NO its deprecated")
    .argument("[prompt...]", "Ask it something. (one shot mode)")
    .option("-p, --provider <provider>", "Ur provider. (groq, openai, anthropic, ollama, custom)")
    .option("-m, --model <model>", "The model's name.")
    .option("-c, --config <path>", "path to your config.json (created if doesnt exist)")
    .option("--stateless", "Isolates the model from .context.json")
    .option("--think", "Show what it thinks.")
    .option("--yolo", "Let the model go hay with your tools")
    .option("--clear", "Destroy .context.json but you know rm -rf .context.json works")
    .option(
      "--ai-comment <enabled>",
      "Enable or disable AI flag commentary (true/false)"
    )
    .helpOption("-h, --help", "This?");

  program.parse(process.argv);

  const options = program.opts();
  const promptArgs = program.args;

  // Second patch contributed by ChatGPT

  // Handle --clear before normal config setup.
  // Commentary must NEVER prevent the operation from completing.
  if (options.clear) {
    let status = 0;

    try {
      clearContext();
      console.log(
        chalk.green("D- Done... but you could've just rm -f .context.json!!")
      );
    } catch (err) {
      status = 1;
      console.error(chalk.red("Failed to clear context:"), err);
    }

    try {
      // Load config opportunistically. Never launch the setup wizard here.
      const config = loadConfig(options.config);

      // An explicit setting takes precedence and is persisted when possible.
      if (options.aiComment !== undefined && config) {
        config.aiComment = options.aiComment === "true";
        saveConfig(config);
      }

      if (options.aiComment === "true" || config?.aiComment) {
        const systemPrompt =
          loadSystemPrompt() || "You are an assistant whose only sole purpose is to generate a comment for a flag the user executed";

        const comment = await generateAiComment(
          config,
          systemPrompt,
          "--clear",
          "--clear",
          status
        );

        console.error(chalk.magenta(`💬 ${comment}`));
      }
    } catch {
      // Commentary is optional. Never change the command's exit status.
      console.error(
        chalk.magenta("💬 The commentator vanished into the void. 💀")
      );
    }

    process.exit(status);
  }


  // Load configuration
  const config = await initializeConfig(options);

  // Read stdin if piped
  const { image, finalPrompt } = await resolveInput(promptArgs);

  // If no prompt and no piped input, start interactive REPL
  if (!finalPrompt) {
    await startRepl(config);
    return;
  }


  // One-shot execution
  const isStateless = Boolean(options.stateless);
  const input = { image, finalPrompt };

  try {
    await executeOneShot(
      config,
      input,
      isStateless,
      Boolean(options.think),
    );
  } catch (err: any) {
    console.error(chalk.red(`\nError: ${err.message}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
