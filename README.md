# askgpt

> [!CAUTION]
Everything here IS FUCKING VIBE-CODED. Don't expect privacy, Antigravity literally found my keys and I had to recycle them.

This is literally just a slim version of Antigravity, but coded using Antigravity. Thanks, Google.

---

## Features

- 💬 **Interactive REPL**: Launch without arguments (`askgpt`) for a full interactive chat terminal.
- ⚡ **One-Shot & Stdin Piping**: Run quick queries like `askgpt "Explain closures in JS"` or pipe files into it: `cat server.log | askgpt "Find the crash reason"`.
- 💾 **Automatic Context (`.context.json`)**: Conversations are saved as standard message arrays in `.context.json` across sessions.
- 🧠 **Dynamic Thinking & Reasoning (`Ctrl + T`)**:
  - Thinking traces are piped to `.reasoning.json` in the background by default.
  - Press **Ctrl + T** at any time to reveal and stream the full reasoning process live.
  - Also captures native reasoning blocks and inline `<think>...</think>` tags (e.g. DeepSeek R1).
- ⚙️ **System Prompt (`.system.txt`)**: Reads instructions from `.system.txt` in the current working directory if present.
- 🛠️ **Tool Calling**: Built-in system tools:
  - `execute_command`: Run shell commands with confirmation prompts.
  - `read_file`: Read file contents.
  - `write_file`: Write or append files.
  - `search_web`: Fast live DuckDuckGo web search (and Groq web search integration).
  - Dynamically load custom tools from `./tools/`.
- 🔌 **Any Provider & Custom API**:
  - Out of the box support for **Groq**, **OpenAI**, **Anthropic**, and **Ollama**.
  - Custom REST API mode with configurable JSON request templates (`{{prompt}}`, `{{messages}}`, `{{system}}`) and JSON response path extraction.
- 🪄 **Interactive Setup Wizard**: Automatically guides you to configure your provider and API key on the first run.

---

## Installation & Setup

```bash
# In the askgpt project directory:
npm run build
npm link
```

Now `askgpt` is accessible globally from any directory in your terminal!

---

## Configuration (`config.json`)

On first launch, if no configuration is found, an interactive wizard prompts you to choose your provider. You can also create `config.json` manually or set environment variables (`GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).

### Example `config.json`:
```json
{
  "provider": "groq",
  "model": "llama-3.3-70b-versatile",
  "apiKey": "gsk_...",
  "thinking": {
    "defaultVisible": false
  }
}
```

### Custom REST Endpoint Example:
```json
{
  "provider": "custom",
  "model": "my-local-llm",
  "custom": {
    "url": "http://127.0.0.1:8080/completion",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json"
    },
    "payloadTemplate": {
      "prompt": "{{prompt}}",
      "temperature": 0.7
    },
    "responsePath": "content"
  }
}
```

---

## Usage

### 1. Interactive Chat REPL
```bash
askgpt
```
In-chat slash commands:
- `/clear`: Clear conversation history in `.context.json`
- `/system`: View/reload `.system.txt`
- `/think`: Toggle thinking visibility (or press `Ctrl+T`)
- `/reasoning`: View last reasoning output from `.reasoning.json`
- `/tools`: View loaded tools
- `/model`: View current provider and model
- `/help`: Show command help
- `/exit`: Quit

### 2. One-Shot Prompts
```bash
askgpt "What is the fastest sorting algorithm in practice?"
```

### 3. Piping Stdin
```bash
cat package.json | askgpt "Analyze the dependencies in this file"
git diff | askgpt "Generate a git commit message for these changes"
```

### 4. CLI Flags
- `--stateless`: Run without reading or updating `.context.json`.
- `--think`: Show reasoning tokens immediately.
- `--yolo`: Automatically approve tool executions without confirmation prompts.
- `-p, --provider <name>`: Override provider (`groq`, `openai`, `anthropic`, `ollama`, `custom`).
- `-m, --model <name>`: Override model.
- `--clear`: Clear `.context.json` and exit.

---

## Testing

Run the test suite:
```bash
npx tsx test/test-core.ts
```
