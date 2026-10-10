# All of this paid off for...

```bash
npm i -g terrible-harness
terrible-harness # or the alternative name, askgpt
```

Done. Literally.

And I suffered through all of this and debugging it with Claude while you guys just read for fun!

# What is this?

Hi. This is `terrible-harness`, previously known as `askgpt`.

This is a project that shows that you can ask Antigravity for a tiny version of it, and you get all of this.

I had to glue all of it together.

Some of the staged patches I haven't incorporated into the project yet, just now other files import from it.

# Now, what flags can I use on it?

Great question! Here:

```text
Usage: terrible-harness/askgpt [options] [prompt...]

The most terrible harness you've ever seen.

Arguments:
  prompt                     Ask it something. (one shot mode)

Options:
  -V, --version              output the version number
  -p, --provider <provider>  Ur provider. (groq, openai, anthropic, ollama, custom)
  -m, --model <model>        The model's name.
  -c, --config <path>        path to your config.json (created if doesnt exist)
  --stateless                Isolates the model from .context.json
  --think                    Show what it thinks.
  --yolo                     Let the model go hay with your tools
  --clear                    Destroy .context.json but you know rm -rf .context.json works
  -h, --help                 This? 
```

# And what about in the prompt thingy thing?

```text
Available Commands:
  /clear                     Clear conversation history in .context.json
  /system                    Reload and display .system.txt
  /think                     Toggle thinking visibility (or press Ctrl+T)
  /reasoning                 View last reasoning trace from .reasoning.json
  /tools                     List available tools
  /model                     Show current provider and model
  /help                      Show this help message
  /exit                      Exit askgpt
  /file=(path to file)       Import a file into the message turn
  /image=(path to image)     Import a image into the message turn

  /summarize                 Summarize the context now (auto at 75% of the window)
  /system global|local       Prefer ~/.terrible-harness/.system.txt or the local .system.txt

That's all you need to know.
```

# License?

MIT.

# Full readme?

[Here.](README.md)
