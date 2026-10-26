
import { Command } from "commander";

export function parseCli() {
  const program = new Command();

  program
    .name("terrible-harness/askgpt")
    .description("The most terrible harness Antigravity made after the ML-Template incident")
    .version("2.7.0 - Apparently its still getting updates while deprecated LMFAOO")
    .argument("[prompt...]", "Ask it something. (one shot mode)")
    .option("-p, --provider <provider>", "Ur provider. (groq, openai, anthropic, ollama, custom)")
    .option("-m, --model <model>", "The model's name.")
    .option("-c, --config <path>", "path to your config.json (created if doesnt exist)")
    .option("--stateless", "Isolates the model from .context.json")
    .option("--think", "Show what it thinks.")
    .option("--yolo", "Let the model go hay with your tools")
    .option("--clear", "Destroy .context.json but you know rm -rf .context.json works")
    .option("--ai-comment <enabled>", "Enable or disable AI flag commentary (true/false)")
    .helpOption("-h, --help", "This?");

  program.parse(process.argv);

  return {
    options: program.opts(),
    promptArgs: program.args,
  };
}

