<p align="center">
  <img src="docs/images/banner.png" alt="terrible-harness" width="720">
</p>

# This is a Terrible Harness, not going to lie (Formerly AskGPT. I still refer to it as AskGPT.)
First,

This is a slim version of the REPL part making up Antigravity. This isn't meant to replace Antigravity, nor replace any other IDEs.

## Patch Notes!
- 1.0.3-test: Added /image=(image) and /file=(file) support, but tbh its too much work when you can cat tax_papers.jpg | askgpt "What do i fill in"
- 1.0.2: Version bump, fixed bug
- 1.0.1: Added image support and pinned down versions so it's less likely to break, contributed by Claude
- 1.0.0: My starter quota got massacred by Antigravity.

> [!NOTE]
This is fully open sourced with the MIT license or more permissive. By using this repository, you acknowledge that this is provided as is, with no warranty expressed or implied, including but not limited to the warranties of merchantability,
fitness for a specific purpose and no infringement. In no event should I be liable for any claims, damages or other liabilities whether in an action of contract tort or otherwise arising from
out of or in connection with this, or the use, or other dealing in this.
Actual note to self: don't let anybody near config.json.
This project may have remnants of my API key. To be honest, I actually already cycled the keys and ran the project through git repo-filter.

Next,

> [!CAUTION]
This is an experimental project that expects the dependencies of this era. I'm not going to write a shim for it; you have to actually grab the Node 24 LTS and npm versions to use this.
Expect everything, if not anything, to break.
The reason?
This was vibe-coded fully using Antigravity.

## Good. Now what do I do with this?

### Install it, obviously!

First,

```any shell

git clone --depth=1 https://github.com/nanopowered08/askgpt.git
cd askgpt

```

I know this is confusing but you can also do:

```any shell

git clone --depth=1 https://github.com/nanopowered08/terrible-harness.git
cd terrible-harness

```

Eitherway it resolves to the same repo just in a different folder.

Install Node on your OS, im pretty sure for Windows its `winget install OpenJS.NodeJS.LTS`, for MacOS its `brew install node@24` and on Debian-based repositories its `apt install nodejs npm -y`

### So how do I even build it?

Well basically you just have to run this.
```any shell
npm i
npm run build
npm link
```

..and thats about it!

### But what about running it?

Since you ran the commands above, the AskGPT Wizard should have shown up. Just fill in your info and you can start!

### It's modes?

Well,

- You can launch the REPL without arguments.
- You can use it to read wtf you want (for example, `cat dist/index.js | askgpt "What this do"` provided you ran it from inside the AskGPT repo)
- It also can read images (if you're using a vision model like qwen/qwen3.8-27b) for example, `cat docs/images/proof.jpg | askgpt "Is the sender and the recipient delusional"`
- Context?? (saved in .context.json)
- Reasoning apparently. (saved in .reasoning.json, to show it press Ctrl+T)
- Prebuilt tools like execute_command, read_file, write_file, search_web loaded from tools/
- It supports whatever the fuck you use, proprietary or not

Oh there's also flags too.

- One shot mode: `askgpt "What happens if you want to destroy this repo?"`
- Shit, we need to see it think without needing Ctrl+T: `askgpt --think "What happens if you want to destroy this repo?"`
- Ykw, Let it do everything: `askgpt --yolo "Read and destroy my digitized tax papers."`
- No, don't use .context.json: `askgpt --stateless "Have i talked to you before"`

And more I'm not willing to write. To see them you have to read the original commit's README.

## Why did you make this in the first place?

I was bored as fuck.

## Bugs?

There is! First:
- **You have to directly specify the model.** You don't just write it like the script expects. For Groq, you write it like (company name, eg openai)/(model name, eg gpt-oss-120b)
- **It burns through all it's tool call turns unless you're smart about it's tool call capabilities.** Most models overspend tools on trying to fetch something locally rather than using the web. This is why .system.txt exists.

# Acknowledgements

- Google, for Gemini.
- Google again, for Antigravity.
- Anthropic, for Claude finding bugs in it and helping as much as it can.
- Anthropic again, for resetting my usage before all of this happened.
- OpenAI, for ChatGPT giving the original idea.
- OpenAI again, for not asking me to start a new chat when my image usage ran out.
- OpenAI, for GPT-OSS and me being able to turn it into a [tsundere](https://vt.tiktok.com/ZSbVQ1W3q/)
- High-Flyer, for DeepSeek.
- High-Flyer again, for DeepSeek's original `askgpt.sh` draft.
