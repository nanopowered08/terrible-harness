<p align="center">
  <img src="docs/images/banner.png" alt="terrible-harness" width="720">
</p>

# This is a Terrible-Harness, *not gonna lie*

*By the way, I will, and **WILL always** call it AskGPT.*

> [!WARNING]
> Notice of Deprecation
>
> Alright guys, so basically I'm in Yukanthor High School now. Great! It's another reason to **update** the repo if I need to make my portfolio.
>
> Don't worry, I'll still develop this.
>
> Refer to the update information for more info.

---

## So, where do I start?

**Install it, obviously!** It's not like I'm trying to help you or anything, but since you asked...

**First, you have to know this!** AskGPT only works if Node.js **is version 20 and up!!** Anything below that, **AskGPT won't work!**

**Oh! I forgot the update information table!!** I'll add it, but *it's not that I want you to read it, I just want you to understand...*

| Method | Updates? (via...) |
|---|---|
| Git (clone) | Latest staging and release updates (git pull) |
| Git (Download as .zip) | No! You have to clone to get the updates I push!! |
| NPM | Rarely... |

**Then, pick a method to install it.** T- Trust me!! *I- I'm not j- judging..*

<details>
<summary>Using Git</summary>

**First clone the repo, dummy!** If you don't clone it, we can't really proceed! **Not that I'm thinking about your installation choice...**

```bash
git clone https://github.com/nanopowered08/askgpt || \
git clone https://github.com/nanopowered08/terrible-harness # if the mirror goes down
```

**Then we have to build it, obviously! Who thinks that a `dist/index.js` comes prepared!?**

Assuming you're in the cloned repo,

```bash
npm i
npx tsup
npm link
```

..so you can use askgpt cli!! *Not that I want you to... it's just cool, alright!?*

</details>

<details>
<summary>Using NPM</summary>

**F- First, make sure NPM is installed!** I- I don't want you *complaining* about it not working to me, dummy!!

Then...

```bash
npm i -g terrible-harness
```

..so you can use askgpt cli by running `npx terrible-harness`!! *W- Wait! Scratch that, just use `askgpt`!! Not that I want to give you a quality of life experience...*

</details>

Then you can simply launch it! *Not that I want you to launch it now..*

> [!CAUTION]
> Hey!! *You do know that* this project needs Node 20 and higher! Don't use any older version than that...

## Alright, now the setup wizard.

### What about it?

**On the first launch, it'll read the .env for an API key!** If neither config.json nor .env exists, AskGPT will create one for you!! *Hmph.. I wanted to make up the config...*

You'll be prompted for ...
- Your model provider (mandatory)
- API Key (mandatory for non-local model inference)
- Model name (eg. gpt-oss-120b)

**..not that you need the API key, alright!?** As long as your own model is local, you can use it!

### Optional config.json fields

- `maxSteps`: hard cap on tool-calling steps per turn (default 50)
- `providerOptions`: passed straight to the AI SDK, keyed by provider. For example, to ask Gemini to send its thoughts separately (so they go to `.reasoning.json` instead of the reply, if your model supports it):

```json
"providerOptions": { "google": { "thinkingConfig": { "includeThoughts": true } } }
```

## MX?

**MX!? I'll show you it, but *it's not like I'm doing this because I want to introduce QOL to you!!***

On Unix/System-V (like) systems, the MX is simply `cat`. Here's an example; go do `cat README.md | askgpt "What does it say"`

If you're using a vision model, better check docs/images, like `cat docs/images/banner.jpg` *I won't do it for you...*

## Flags!

**I guess I'll send you what AskGPT flags looks like, not that I care for your accessibility or anything!**

- -v (--version):  displays the version number
- -p (--provider): change your model provider in one-shot
- -m (--model):    change the model to what the model provider can provide (Opional, but required as dependency for -p)
- -c (--config):   use a config from a specific folder
- --stateless: run the model without .context.json
- --think: show what the model thinks
- --yolo: let the model do everything
- --clear: deletes .context.json which is global
- --ai-comment: let the model respond to the flag you use, only works with clear

**Note that you can also find these inside of AskGPT aswell.**

## In-REPL Flags!

- /clear                     Clear conversation history in .context.json
- /system                    Reload and display .system.txt
- /think                     Toggle thinking visibility (or press Ctrl+T)
- /reasoning                 View last reasoning trace from .reasoning.json
- /tools                     List available tools
- /model                     Show current provider and model
- /help                      Show this help message
- /exit                      Exit askgpt
- /file=(path to file)       Import a file into the message turn
- /image=(path to image)     Import an image into the message turn

## Known bugs

**There's stuff in this project aswell! Not that I'm not going to fix it anyways...**
- (Groq Users) **Groq says they can't find the model!** That's because you forgot to put the model name alongside where it belongs, like openai/gpt-oss-120b.
- (Tool-use Users) **Compatibility with every OS isn't guarenteed!** `execute_command`, for instance, only executes a command...
- (Gemini Users) **Gemini isn't doing what I asked it to do!** v2.7 doesn't have the full Terrible-Harness constitution, please wait for now...

## Incident Reports
- **Gemini had beef with the perrson paying for the API.** Gemini, how are you not discarded yet!?
- **GPT-OSS is now technically Claude!!** Not that I'm jealous... I just forgot to change the system prompt...
- **School started.** Updates get rarer overtime...

## WHat's your pitch for this project?

None. I was bored as fuck.

## Acknowledgements

- **Anthropic** for Claude and contributing as much as it can for images
- **Google** for Gemini being this easy to start a roleplay with apparently
- **OpenAI** for ChatGPT, original idea
- **High-Flyer** for DeepSeek, helped make the original `askgpt.sh` SH script

## Patch Notes!!

- 1.0.0: **My Antigravity usage got massacred.**
- 1.1.0: **Claude added image support to one-shot mode.**
- 1.2.3: **QOL - Day 1:** Claude fixed some bugs inside of the code. Haven't used TypeScript to typecheck it.
- 1.3.1: **QOL - Day 2:** FINALLY DUDE Claude implemented support for /image and /file YAYYY
- 1.4.0: **The Revisions of Visions:** WHY THE FUCK DID I DESTROY SemVer
- 1.5.2: **Fish seller in a fruit market:** Somehow I got on NPM :sob:
- 1.6.2: **Bumper:** Had to bump shit up by a notch and theres no known vulnerabilities yet
- 1.7.2: **Absolute Yapper:** Had to put more NPM install instructions for NPM users
- 1.7.21: **rePublished (under a different name):** Terrible-Harness isnt taken yet but askgpt npm package IS taken. Best way to be honest?
- 1.7.22: **reLinked:** Had to relink some scripts for NPM users
- 1.8.1: **First Staging:** FINALLY GOD, I ACTUALLY CAN PATCH IT NOW
- 1.9.2: **NPM destage:** Upload patches to NPM
- 2.0.0: **New Provider:** Google support added by Gemini, with Generative AI SDK (to be deprecated)
- 2.0.2: **reBumper:** Bump again!!
- 2.1.2: **Gemini autoTools:** Uhh, i added tool support to Gemini
- 2.2.2: **I- I have a reason, y- you k- know that!?:** Pressing tab now lets people answer why they declined a tool
- 2.3.2: **Models open webpages:** Thanks, DuckDuckGo.
- 2.4.2: **The Deprecation:** Wow, we're coming to an end on NPM.
- 2.5.2: **reBumped, NPM:** Hmph! I'm not gonna-
- 2.6.0: **"Why the fuck are there COMMENTERS!?":** Your models can now read *your flags and comment on it...*
- 2.7.0: **THE DEBLOAT OF THE CENTURY:** Index.ts only handles coordination now, the rest got sent to src/execution
- 2.8.0: **Show me the diff, dummy!!:** `write_file` now previews a diff and asks before writing (y / N / Tab to give a reason). Old contents are backed up to `.terrible-harness-backups/`. `--yolo` skips the prompt.
- 2.9.0: **Read it first, baka!!:** `write_file` now refuses to overwrite a file the model hasn't read (or that changed since). Rejections show the model the real file contents, and tool lines now say `rejected` / `failed` instead of always `completed`.
- 2.10.0: **I- I remember what I did, y- you know!?:** Tool calls and results are now saved with each turn, so the model stops re-listing folders and re-reading files every step.
- 2.11.0: **Stop breaking in weird ways!!:** Tool errors are reported and remembered, replies from different steps no longer get glued together, `<think>` tags split across chunks are handled, a 50-step cap per turn (`maxSteps` in config), provider failures now exit with code 1 without leaving your message hanging in `.context.json`, and one-shot mode auto-summarizes like the REPL.
- 2.12.0: **Let me pass options, baka!!:** New `providerOptions` in config.json, passed straight to the AI SDK. Try Gemini's `thinkingConfig.includeThoughts` to keep its thoughts out of the reply.

> [!NOTE]
> The full license is [here.](LICENSE)
> But.. I know you're gonna not read it so I'll include it here!!
> This repository is licensed under the MIT license, dummy!! **B- By using this repository...** you pretty much understand that it's **provided as-is!! ALRIGHT!?** T- This also means *there's no warranty expressed or implied,* but it's not limited to that, too!! There's no warranty of merchantability, no warranty for a specific purpose, and no warranty for infringement!! If you cause a scene... w- well I (and the other contributers of this repository) are not liable for any damages or liabilities, not even claims aswell, even if in a contract of any kind arising in or outside connections with this, or the use, or other dealing in this, dummy!! Don't get the wrong idea!!
