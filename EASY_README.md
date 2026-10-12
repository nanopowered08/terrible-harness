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

- -v simply means print the version number. --version does the same thing.
- -p or --provider lets you change your provider.
- -m or --model lets you change your model.
- -c or --config lets you test your own configuration on AskGPT
- --stateless doesn't use the .context.json.
- --think shows reasoning.
- --yolo approves every command letting you do `cat tax_papers.jpg | askgpt --yolo "Read and delete this"`
- --clear just deletes .context.json.
- -h or --help shows this.

# And what about in the prompt thingy thing?

WELLLL....

- /clear deletes the .context.json
- /system global|local either loads the .system.txt from ~/.terrible-harness (global) or read the .system.txt from where you launched AskGPT.
- /think shows reasoning.
- /reasoning lets you view previous message's resoning.
- /tools shows what tools you have.
- /models shows the model and it's providers.
- /help just shows this.
- /exit just does what it does.
- /image=(path to image) sends the model an image.
- /file=(path to file) sends the model a file.

# License?

MIT.

# Full readme?

[Here.](README.md)

# Now for the actual version patches.

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

