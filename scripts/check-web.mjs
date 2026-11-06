// Syntax-checks every inline <script> in web/*.html. One stray character in that
// script (it once had a literal "\n" in it) stops the whole dashboard from working.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
let failed = false;

for (const file of fs.readdirSync(webDir).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(webDir, file), "utf8");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, i) => {
    try {
      new vm.Script(match[1], { filename: `${file} <script #${i + 1}>` });
    } catch (error) {
      failed = true;
      console.error(`web/${file} script #${i + 1}: ${error.message}`);
    }
  });
  if (!failed) console.log(`web/${file}: ${scripts.length} script(s) OK`);
}
process.exit(failed ? 1 : 0);
