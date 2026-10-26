import chalk from "chalk";
import { parseCli } from "./cli.js";
import { executeClear } from "./execution/clear.js";
import { executeOneShot } from "./execution/one-shot.js";
import { resolveInput } from "./execution/input.js";
import { startRepl } from "./repl.js";
import { initializeConfig } from "./execution/configuration.js";

(globalThis as any).AI_SDK_LOG_WARNINGS = false;


async function main() {

  // Deprecation notice
  console.log(chalk.red(`!! `), chalk.blue(`This project is deprecated`), chalk.red(` !!`));
  console.log(chalk.gray(`Learn why at https://github.com/nanopowered08/askgpt. `));

  const { options, promptArgs } = parseCli();

  // Handle --clear before normal config setup.
  // Commentary must NEVER prevent the operation from completing.
  if (options.clear) {
    await executeClear(options);
    return;
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
