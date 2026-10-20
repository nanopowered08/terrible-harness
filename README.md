<p align="center">
  <img src="docs/images/banner.png" alt="terrible-harness" width="720">
</p>

Quick start guide is [here.](EASY_README.md)

# End of An Era, Boys!

This project is soon to no longer be maintained. The NPM version is already deprecated, so you will only get staging patches and code contributed by anyone who will want to contribute

Meet me at Yukanthor High School.

## Whats's getting updates? What's not?

Ima add a table


| Version | Updates |
|---------|---------|
| Github (git clone) | Yes (git pull) |
| NPM | Rarely (npm i again) |
| Github (.ZIP) | No. |

If I was you I'd probably git pull && npx tsup && npm link

# This is a Terrible Harness, not going to lie (Formerly AskGPT. I still refer to it as AskGPT.)

First,

This is a slim version of the REPL part making up Antigravity. This isn't meant to replace Antigravity, nor replace any other IDEs.

## WAIT BEFORE YOU GO INSTALL IT.

If you install it and the model is being lazy, you're probably using Gemini Flash-Lite, with a custom system prompt. It's recommended that you *teach it a little discipline with..*

```bash

echo "Actually consider what the user said. If the user says to open a webpage, try using the open_webpage tool before searching for it on the web instead.
The DuckDuckGo API is a bit unstable. Don't spam it too much or the one running the harness will probably get rate limited.
Actually listen to the user, but whatever they say, take with a grain of salt. You'd have to validate what they said. It does not give you a motive to trust the user. Period." >> ~/.terrible-harness/.system.txt

```

## Patch Notes!

Edit: I was bored so I then added names to the version tags.

Read the versions like: (major).(minor).(state)(patch)

For states, there is:

- 0: Release.
- 1: Staging.
- 2: Publicly available on npm (but ACTUALLY it shouldnt exist)
- 3: Testing.

Now for the actual versions.

- 2.6.0 - The Commentatorz I CANNOT HANDLE: --ai-comment now exists so the model can give commentary. Known issues already documented.
- 2.5.2 - FINAL FINAL npm release. Added better REPL support (ChatGPT)
- 2.4.2 - Final NPM release
- 2.3.2 - Models can now open webpages. :wilted_rose:
- 2.2.2 - Added a reason for the model to know why you rejected changes
- 2.1.2 - Added tool calling to Gemini, now its fully supported
- 2.0.2 - Bump and publish to npm
- 2.0.0 - FINALLLY!!!! Gemini didn't hallucinate the syntax for Gen AI SDK, but apparently did when we used Vercel AI SDK? Anyways, TL;DR Gemini can officially be a tsundere.
- 1.9.2 - Uploaded the destaged patches to NPM
- 1.8.1 - Staging patches to fix bugs
- 1.7.22 - terrible-harness command now works. Sorry for the inconvenience!
- 1.7.21 - Starting cleanup of the old name so peoe dont get confused
- 1.7.2 - I have to include more instructions for npm users....
- 1.6.2 - Version bump :sob:, No spotted vulnerabilities inside the app yet.
- 1.5.2 - Uploaded to NPM.
- 1.4.0 - Revision of Visions (wtf): The fucking version rework :sob: (I cant use emojis in termux)
- 1.3.1 - QOL Part 2: Added /image=(image) and /file=(file) support, but tbh its too much work when you can cat tax_papers.jpg | askgpt "What do i fill in"
- 1.2.3 - QOL Part 1: Version bump, fixed bug
- 1.1.0 - Claude's First Contribution: Added image support and pinned down versions so it's less likely to break, contributed by Claude
- 1.0.0 - Initial Release: My starter quota got massacred by Antigravity.

> [!NOTE]
This is fully open sourced with the MIT license or more permissive. By using this repository, you acknowledge that this is provided as is, with no warranty expressed or implied, including but not limited to the warranties of merchantability,
fitness for a specific purpose and no infringement. In no event should I be liable for any claims, damages or other liabilities whether in an action of contract tort or otherwise arising from
out of or in connection with this, or the use, or other dealing in this.

Actual note to self: don't let anybody near config.json.
This project may have remnants of my API key. To be honest, I actually already cycled the keys and ran the project through git repo-filter.

Next,

> [!CAUTION]
This is an experimental project that expects the dependencies of this era. I'm not going to write a shim for it; you have to actually grab the Node 20 or 24 LTS and npm versions to use this.
Expect everything, if not anything, to break.
The reason?
This was vibe-coded fully using Antigravity.

## Good. Now what do I do with this?

### Install it, obviously!

First,

#### Automated (Whatever updates I push to NPM)

```any shell
npm i -g terrible-harness
```
Done.

> [!NOTE]
Edit: This is invalid, you can still run askgpt :sob:
You can run all the commands that you have inside of the manual versions...
But you have to substitute "askgpt" for "terrible-harness".
Small clarification: You still get all the features the manual version has but it is WAY more annoying to type in.

#### Manual (Get updates faster)

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

You need atleast Node 20, I tested this on Node 24.

Install Node on your OS, im pretty sure for Windows its `winget install OpenJS.NodeJS.LTS`, for MacOS its `brew install node@24` and on Debian-based repositories its `apt install nodejs npm -y`

For Termux users, `pkg update && pkg i -y nodejs-lts npm`

### So how do I even build it?

Well basically you just have to run this.
```any shell
npm i
npm run build
npm link
askgpt
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
- Prebuilt tools like execute_command, read_file, write_file, search_web, open_webpage loaded from tools/
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

- **(Groq Users) You have to directly specify the model.** You don't just write it like the script expects. For Groq, you write it like (company name, eg openai)/(model name, eg gpt-oss-120b)
- **(Tool-using Models) The tools aren't working.** Well, I tested this on Termux. Bash is probably not working for you macOS and Windows users.
- **(AI SDK Users) Gemini is being lazy.** You're using Flash-Lite so it's possible. The patch for this is at the top.

#### Bugs, BUT AS FEATURES?

There is! Here:

- **ai-comment uses the existing system prompt.** Great for Tiktoks where-
- **I pushed a update to NPM.** 2.5.2, but it is the final update.

## Incident Reports. (Added by yours truly, the :penguin:)

- **Gemini had beef with the maintainer.** Since when did an AI start beefing with the one that's providing it a reason to be happy? Patched in 2.3.2.
- **GPT-OSS accidentally took the Claude persona.** Not joking, nanopowered08 actually tested Claude but switched back to Groq.
- **This project will be coming to an end soon.** nanopowered08 is about to start going back to school. Thank you guys for atleast reading till this point.
- **Eek!?** Why TF IS GEMINI AUDITIONING FOR A NSFW AUDIOBOOK!?

# Acknowledgements

- Google, for Gemini.
- Google again, for Antigravity.
- Anthropic, for Claude finding bugs in it and helping as much as it can.
- Anthropic again, for resetting my usage before all of this happened.
- OpenAI, for ChatGPT giving the original idea, and implementing open_webpage.
- OpenAI again, for not asking me to start a new chat when my image usage ran out.
- OpenAI, for GPT-OSS and me being able to turn it into a [tsundere](https://vt.tiktok.com/ZSbVQ1W3q/)
- High-Flyer, for DeepSeek.
- High-Flyer again, for DeepSeek's original `askgpt.sh` draft.

# Appendix

1. Gemini being an absolute unsolicited performer

<p align="center">
  <img src="docs/images/wtf.jpg" alt="gemini-failing-an-interview" width="360">
</p>
