// src/edit.ts
// The /edit commands of the REPL:
//   /edit cfg     browse and change config.json options, or switch to another configuration
//   /edit mcp     add, change, disable or remove MCP servers
//   /edit system  open the system prompt in your text editor, then reload it
//
// Config edits always read and write the file as written (no environment
// overrides), so an API key that only exists in the environment never ends up
// in config.json by accident.

import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import chalk from "chalk";
import { select, input, password, confirm } from "@inquirer/prompts";
import type { AskGptConfig, McpServerConfig, ProviderType } from "./types.js";
import {
  GLOBAL_CONFIG_DIR,
  GLOBAL_CONFIG_FILE,
  PROVIDER_CHOICES,
  DEFAULT_MODELS,
  getLoadedConfigFile,
  setLoadedConfigFile,
  listConfigFiles,
  loadConfig,
  readRawConfig,
  writeConfigFile,
  promptProviderSettings,
  runConfigWizard
} from "./config.js";
import { SYSTEM_FILE } from "./context.js";
import { GLOBAL_SYSTEM_FILE } from "./Summarize.js";

/** What /edit needs from the REPL. */
export interface EditHost {
  getConfig(): AskGptConfig;
  /** Merge into the live config; a key set to undefined is removed. */
  updateConfig(patch: Partial<AskGptConfig>): void;
  /** Switch the session to a different configuration. */
  replaceConfig(next: AskGptConfig): Promise<void>;
  /** Apply a changed MCP server list (reconnects). */
  applyMcpServers(servers: Record<string, McpServerConfig> | undefined): Promise<void>;
  getPreferGlobal(): boolean;
  /** Re-read the system prompt; returns the user's own text (or null if there is none). */
  reloadSystemPrompt(): string | null;
}

// ---------------------------------------------------------------------------
// Small helpers (exported so they can be tested)
// ---------------------------------------------------------------------------

/** Splits "a b 'c d'" into ["a", "b", "c d"]. Understands single and double quotes. */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let started = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) out.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started || cur) out.push(cur);
  return out;
}

/** Inverse of splitArgs: quotes anything with spaces. */
export function joinArgs(args: string[] | undefined): string {
  return (args ?? [])
    .map((a) => (a === "" || /[\s"']/.test(a) ? `"${a.replace(/"/g, "'")}"` : a))
    .join(" ");
}

const SENSITIVE = /key|token|secret|auth|pass|cookie/i;

function maskSecret(value: string): string {
  return value.length > 12 ? `••••${value.slice(-4)}` : "••••";
}

function describeServer(cfg: McpServerConfig): string {
  if (cfg.command) return `stdio: ${[cfg.command, ...(cfg.args ?? [])].join(" ")}`;
  if (cfg.url) return `${cfg.type ?? (/\/sse\/?$/.test(cfg.url) ? "sse" : "http")}: ${cfg.url}`;
  return "(incomplete)";
}

function short(text: string, max = 70): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function tilde(file: string): string {
  const home = os.homedir();
  return file.startsWith(home) ? "~" + file.slice(home.length) : file;
}

function isCancel(err: any): boolean {
  return err?.name === "ExitPromptError";
}

/** Runs one /edit command; Ctrl+C inside a prompt just cancels it. */
export async function runEdit(
  what: string,
  host: EditHost
): Promise<void> {
  const target = what.trim().toLowerCase();
  const known = ["cfg", "config", "mcp", "system"];
  if (!known.includes(target)) {
    console.log(chalk.bold("\nUsage:"));
    console.log(`  ${chalk.cyan("/edit cfg")}      Look through and change your config.json options, or load another configuration`);
    console.log(`  ${chalk.cyan("/edit mcp")}      Add, change, disable or remove MCP servers`);
    console.log(`  ${chalk.cyan("/edit system")}   Open the system prompt in your text editor and reload it when you close it\n`);
    return;
  }

  if (target !== "system" && !process.stdin.isTTY) {
    console.log(chalk.yellow("/edit needs an interactive terminal."));
    return;
  }

  try {
    if (target === "system") await editSystem(host);
    else if (target === "mcp") await editMcp(host);
    else await editConfig(host);
  } catch (err: any) {
    if (isCancel(err)) console.log(chalk.yellow("\nCancelled."));
    else console.error(chalk.red(`\nError: ${err?.message ?? String(err)}`));
  }
}

// ---------------------------------------------------------------------------
// /edit system
// ---------------------------------------------------------------------------

function onPath(cmd: string): boolean {
  if (cmd.includes("/") || cmd.includes(path.sep)) return fs.existsSync(cmd);
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

/** $VISUAL, then $EDITOR, then the first of nano / vim / vi that exists. */
export function findEditor(): string[] | null {
  const candidates = [process.env.VISUAL, process.env.EDITOR, "nano", "vim", "vi"];
  for (const c of candidates) {
    if (!c?.trim()) continue;
    const parts = splitArgs(c);
    if (parts.length && onPath(parts[0])) return parts;
  }
  return null;
}

/** The system prompt file that is in use: the one /system global|local points at. */
export function systemPromptTarget(preferGlobal: boolean): string {
  const local = path.resolve(process.cwd(), SYSTEM_FILE);
  if (preferGlobal) return GLOBAL_SYSTEM_FILE;
  if (fs.existsSync(local)) return local;
  if (fs.existsSync(GLOBAL_SYSTEM_FILE)) return GLOBAL_SYSTEM_FILE;
  return local;
}

async function editSystem(host: EditHost): Promise<void> {
  const editor = findEditor();
  if (!editor) {
    console.log(chalk.yellow("No text editor found. Set one with: export EDITOR=nano"));
    return;
  }

  const file = systemPromptTarget(host.getPreferGlobal());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;

  console.log(chalk.gray(`Opening ${tilde(file)} in ${editor[0]}...`));
  const result = spawnSync(editor[0], [...editor.slice(1), file], { stdio: "inherit" });

  if (result.error) {
    console.error(chalk.red(`Could not start ${editor[0]}: ${result.error.message}`));
    return;
  }
  if (result.status !== 0 && result.status !== null) {
    console.log(chalk.yellow(`${editor[0]} exited with code ${result.status}; reloading anyway.`));
  }

  const after = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const prompt = host.reloadSystemPrompt();

  if (after === before) {
    console.log(chalk.green("System prompt reloaded (no changes)."));
  } else if (prompt) {
    console.log(chalk.green(`System prompt reloaded from ${tilde(file)} (${prompt.length} characters).`));
  } else {
    console.log(chalk.green("System prompt reloaded: no custom instructions now (the harness rules still apply)."));
  }
}

// ---------------------------------------------------------------------------
// Config file access shared by /edit cfg and /edit mcp
// ---------------------------------------------------------------------------

/** The file to edit; offers to create one when the config only comes from environment variables. */
async function ensureConfigFile(host: EditHost): Promise<string | null> {
  const existing = getLoadedConfigFile();
  if (existing && fs.existsSync(existing)) return existing;

  console.log(chalk.yellow("\nThis session isn't using a config file (settings come from environment variables)."));
  const create = await confirm({
    message: `Create ${tilde(GLOBAL_CONFIG_FILE)} from the current settings? (an API key from the environment would be saved into it)`,
    default: false
  });
  if (!create) return null;

  writeConfigFile(GLOBAL_CONFIG_FILE, host.getConfig());
  setLoadedConfigFile(GLOBAL_CONFIG_FILE);
  console.log(chalk.green(`Created ${tilde(GLOBAL_CONFIG_FILE)}.`));
  return GLOBAL_CONFIG_FILE;
}

function readOrExplain(file: string): AskGptConfig | null {
  try {
    return readRawConfig(file);
  } catch (err: any) {
    console.error(chalk.red(`Can't read ${tilde(file)}: ${err.message}`));
    console.error(chalk.gray("Nothing was changed. Fix the file (or restore it) and try again."));
    return null;
  }
}

/** Applies { key: undefined } as "remove this key". */
function applyPatch<T extends object>(target: T, patch: Partial<T>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete (target as any)[key];
    else (target as any)[key] = value;
  }
}

// ---------------------------------------------------------------------------
// /edit mcp
// ---------------------------------------------------------------------------

/** Add / change / remove entries of a name -> value map (environment variables, headers). */
async function editMap(
  title: string,
  current: Record<string, string> | undefined
): Promise<Record<string, string> | undefined> {
  const map: Record<string, string> = { ...(current ?? {}) };

  for (;;) {
    const keys = Object.keys(map);
    console.log(chalk.bold(`\n${title}`));
    if (keys.length === 0) console.log(chalk.dim("  (none)"));
    for (const k of keys) {
      console.log(`  ${k} = ${SENSITIVE.test(k) ? maskSecret(map[k]) : short(map[k], 50)}`);
    }
    console.log(chalk.dim("  Tip: ${NAME} in a value is replaced by that environment variable when connecting."));

    const action = await select({
      message: title,
      choices: [
        { name: "Add or change an entry", value: "set" },
        ...(keys.length ? [{ name: "Remove an entry", value: "remove" }] : []),
        { name: "Done", value: "done" }
      ]
    });
    if (action === "done") break;

    if (action === "set") {
      const name = (await input({ message: "Name:", validate: (v) => v.trim() !== "" || "Required" })).trim();
      const value = SENSITIVE.test(name)
        ? await password({ message: `Value for ${name} (leave empty to keep the current one):`, mask: "*" })
        : await input({ message: `Value for ${name}:`, default: map[name] ?? "" });
      if (value !== "" || !(name in map)) map[name] = value;
    } else {
      const key = await select({ message: "Remove which one?", choices: keys.map((k) => ({ name: k, value: k })) });
      delete map[key];
    }
  }

  return Object.keys(map).length ? map : undefined;
}

async function promptServer(existing?: McpServerConfig): Promise<McpServerConfig> {
  const currentTransport = existing?.command
    ? "stdio"
    : existing?.url
      ? existing.type ?? (/\/sse\/?$/.test(existing.url) ? "sse" : "http")
      : undefined;

  const transport = await select({
    message: "How does this server run?",
    default: currentTransport,
    choices: [
      { name: "stdio (a program started on this device)", value: "stdio" },
      { name: "http (Streamable HTTP URL)", value: "http" },
      { name: "sse (SSE URL)", value: "sse" }
    ]
  });

  const next: McpServerConfig = { ...(existing ?? {}) };
  const keepEnabled = existing?.disabled;

  if (transport === "stdio") {
    delete next.url;
    delete next.type;
    delete next.headers;

    let command = (
      await input({
        message: "Command:",
        default: existing?.command ?? "",
        validate: (v) => v.trim() !== "" || "Required"
      })
    ).trim();
    let argsText = await input({
      message: "Arguments (separated by spaces; use quotes around ones with spaces):",
      default: joinArgs(existing?.args)
    });

    // "node /path/server.mjs" typed into the command box: split it for them
    if (/\s/.test(command) && !fs.existsSync(command) && argsText.trim() === "") {
      const parts = splitArgs(command);
      command = parts[0];
      argsText = joinArgs(parts.slice(1));
      console.log(chalk.gray(`Split into command "${command}" and arguments: ${argsText}`));
    }
    next.command = command;
    const args = splitArgs(argsText);
    if (args.length) next.args = args;
    else delete next.args;

    const cwd = (await input({ message: "Working directory (optional):", default: existing?.cwd ?? "" })).trim();
    if (cwd) next.cwd = cwd;
    else delete next.cwd;

    if (await confirm({ message: "Edit environment variables?", default: false })) {
      const env = await editMap("Environment variables", existing?.env);
      if (env) next.env = env;
      else delete next.env;
    }

    const logs = await confirm({
      message: "Show the server's own log output in this terminal? (useful when it fails to start)",
      default: existing?.stderr === "inherit"
    });
    if (logs) next.stderr = "inherit";
    else delete next.stderr;
  } else {
    delete next.command;
    delete next.args;
    delete next.env;
    delete next.cwd;
    delete next.stderr;

    const url = (
      await input({
        message: "URL:",
        default: existing?.url ?? "",
        validate: (v) => {
          try {
            new URL(v.replace(/\$\{[A-Za-z0-9_]+\}/g, "x"));
            return true;
          } catch {
            return "Enter a full URL, like http://127.0.0.1:8787/mcp";
          }
        }
      })
    ).trim();
    next.url = url;

    if (transport === "sse") next.type = "sse";
    else if (/\/sse\/?$/.test(url)) next.type = "http";
    else delete next.type;

    if (await confirm({ message: "Edit headers (for tokens and the like)?", default: false })) {
      const headers = await editMap("Headers", existing?.headers);
      if (headers) next.headers = headers;
      else delete next.headers;
    }
  }

  const auto = await confirm({
    message: "Skip the approval prompt for this server's tools? (they can change your files and projects)",
    default: existing?.autoApprove === true
  });
  if (auto) next.autoApprove = true;
  else delete next.autoApprove;

  if (keepEnabled) next.disabled = true;
  return next;
}

async function editMcp(host: EditHost): Promise<void> {
  const file = await ensureConfigFile(host);
  if (!file) return;
  const raw = readOrExplain(file);
  if (!raw) return;

  const servers: Record<string, McpServerConfig> = { ...(raw.mcpServers ?? {}) };
  let changed = false;

  const save = (): void => {
    if (Object.keys(servers).length) raw.mcpServers = servers;
    else delete raw.mcpServers;
    writeConfigFile(file, raw);
    changed = true;
  };

  console.log(chalk.gray(`MCP servers in ${tilde(file)}`));

  for (;;) {
    const names = Object.keys(servers);
    const pick = await select({
      message: "MCP servers",
      choices: [
        ...names.map((n) => ({
          name:
            `${n}  ${chalk.gray(short(describeServer(servers[n])))}` +
            (servers[n].disabled ? chalk.yellow("  [disabled]") : "") +
            (servers[n].autoApprove ? chalk.red("  [auto-approve]") : ""),
          value: n
        })),
        { name: "+ Add a new server", value: "__add" },
        { name: "Done", value: "__done" }
      ]
    });

    if (pick === "__done") break;

    if (pick === "__add") {
      const name = (
        await input({
          message: "Name for this server (used as the tool prefix, e.g. studio):",
          validate: (v) =>
            !/^[A-Za-z0-9_-]+$/.test(v.trim())
              ? "Use letters, numbers, - and _ only"
              : v.trim() in servers
                ? "That name is already used"
                : true
        })
      ).trim();
      servers[name] = await promptServer();
      save();
      console.log(chalk.green(`Added "${name}".`));
      continue;
    }

    for (;;) {
      const action = await select({
        message: `${pick}  (${short(describeServer(servers[pick]))})`,
        choices: [
          { name: "Edit settings", value: "edit" },
          { name: servers[pick].disabled ? "Enable" : "Disable", value: "toggle" },
          { name: "Remove", value: "remove" },
          { name: "Back", value: "back" }
        ]
      });
      if (action === "back") break;

      if (action === "edit") {
        servers[pick] = await promptServer(servers[pick]);
        save();
        console.log(chalk.green(`Updated "${pick}".`));
      } else if (action === "toggle") {
        if (servers[pick].disabled) delete servers[pick].disabled;
        else servers[pick].disabled = true;
        save();
        console.log(chalk.green(`${servers[pick].disabled ? "Disabled" : "Enabled"} "${pick}".`));
      } else if (action === "remove") {
        if (await confirm({ message: `Remove "${pick}" from the config?`, default: false })) {
          delete servers[pick];
          save();
          console.log(chalk.green(`Removed "${pick}".`));
          break;
        }
      }
    }
  }

  if (changed) {
    host.updateConfig({ mcpServers: Object.keys(servers).length ? servers : undefined });
    await host.applyMcpServers(Object.keys(servers).length ? servers : undefined);
  } else {
    console.log(chalk.gray("No changes."));
  }
}

// ---------------------------------------------------------------------------
// /edit cfg
// ---------------------------------------------------------------------------

function describeValue(raw: AskGptConfig, key: string, host: EditHost): string {
  const live = host.getConfig() as any;
  const r = raw as any;
  const note = (k: string): string =>
    k in live && JSON.stringify(live[k]) !== JSON.stringify(r[k]) ? chalk.yellow(`  (this session: ${live[k] ?? "unset"})`) : "";

  switch (key) {
    case "provider":
      return `${raw.provider}${note("provider")}`;
    case "model":
      return `${raw.model}${process.env.MODEL ? chalk.yellow("  (overridden by $MODEL)") : note("model")}`;
    case "apiKey":
      return raw.apiKey ? maskSecret(raw.apiKey) : chalk.dim("(not set)");
    case "baseURL":
      return raw.baseURL || chalk.dim("(default)");
    case "thinking":
      return raw.thinking?.defaultVisible ? "visible" : "hidden";
    case "autoApproveTools":
      return (raw.autoApproveTools ? chalk.red("yes (no prompts)") : "no") + (live.autoApproveTools && !raw.autoApproveTools ? chalk.yellow("  (this session: yes, from --yolo)") : "");
    case "maxSteps":
      return raw.maxSteps ? String(raw.maxSteps) : chalk.dim("(default 50)");
    case "providerOptions":
      return raw.providerOptions ? short(JSON.stringify(raw.providerOptions), 50) : chalk.dim("(none)");
    case "aiComment":
      return raw.aiComment ? "on" : "off";
    case "mcpServers": {
      const n = Object.keys(raw.mcpServers ?? {}).length;
      return n ? `${n} server${n === 1 ? "" : "s"}` : chalk.dim("(none)");
    }
    case "custom":
      return raw.custom?.url ?? chalk.dim("(not set)");
    default:
      return "";
  }
}

async function editConfig(host: EditHost): Promise<void> {
  let file = await ensureConfigFile(host);
  if (!file) return;

  for (;;) {
    const raw = readOrExplain(file);
    if (!raw) return;

    const rows: { key: string; label: string }[] = [
      { key: "provider", label: "Provider" },
      { key: "model", label: "Model" },
      { key: "apiKey", label: "API key" },
      { key: "baseURL", label: "Base URL" },
      { key: "thinking", label: "Thinking" },
      { key: "autoApproveTools", label: "Auto-approve tools" },
      { key: "maxSteps", label: "Max steps per turn" },
      { key: "providerOptions", label: "Provider options" },
      { key: "aiComment", label: "AI comment" },
      ...(raw.provider === "custom" ? [{ key: "custom", label: "Custom API" }] : []),
      { key: "mcpServers", label: "MCP servers" }
    ];

    const pick = await select({
      message: `Configuration: ${tilde(file)}`,
      pageSize: 14,
      choices: [
        ...rows.map((r) => ({ name: `${r.label.padEnd(20)} ${describeValue(raw, r.key, host)}`, value: r.key })),
        { name: chalk.cyan("Load another configuration..."), value: "__load" },
        { name: "Done", value: "__done" }
      ]
    });

    if (pick === "__done") return;

    if (pick === "__load") {
      const switched = await loadAnotherConfiguration(host);
      if (switched) file = switched;
      continue;
    }

    const patch = await editOption(pick, raw, host);
    if (!patch) continue;

    const cleaned: Partial<AskGptConfig> = { ...patch };
    applyPatch(raw, cleaned);
    writeConfigFile(file, raw);
    host.updateConfig(cleaned);
    console.log(chalk.green(`Saved to ${tilde(file)}.`));
  }
}

/** Asks for a new value for one option. Returns the changes to apply, or null for none. */
async function editOption(key: string, raw: AskGptConfig, host: EditHost): Promise<Partial<AskGptConfig> | null> {
  switch (key) {
    case "provider": {
      const provider = (await select({
        message: "Provider:",
        default: raw.provider,
        choices: PROVIDER_CHOICES
      })) as ProviderType;
      if (provider === raw.provider) return null;
      // A new provider needs its own key/model/URL; don't reuse the old provider's values.
      const settings = await promptProviderSettings(provider, { model: DEFAULT_MODELS[provider] });
      return {
        provider,
        model: settings.model,
        apiKey: settings.apiKey,
        baseURL: settings.baseURL,
        ...(settings.custom ? { custom: settings.custom } : {})
      };
    }
    case "model": {
      const model = (await input({ message: "Model:", default: raw.model, validate: (v) => v.trim() !== "" || "Required" })).trim();
      return model === raw.model ? null : { model };
    }
    case "apiKey": {
      const apiKey = await password({
        message: raw.apiKey ? "New API key (leave empty to keep the current one):" : "API key:",
        mask: "*"
      });
      return apiKey ? { apiKey } : null;
    }
    case "baseURL": {
      const value = (await input({ message: "Base URL (empty for the provider's default):", default: raw.baseURL ?? "" })).trim();
      return { baseURL: value || undefined };
    }
    case "thinking": {
      const visible = await confirm({
        message: "Show the model's thinking by default? (Ctrl+T toggles it anyway)",
        default: raw.thinking?.defaultVisible === true
      });
      return { thinking: { ...(raw.thinking ?? {}), defaultVisible: visible } };
    }
    case "autoApproveTools": {
      const on = await confirm({
        message: "Skip approval prompts for commands, file writes and MCP tools? (same as --yolo)",
        default: raw.autoApproveTools === true
      });
      return { autoApproveTools: on ? true : undefined };
    }
    case "maxSteps": {
      const text = (await input({
        message: "Max tool steps per turn (empty for the default, 50):",
        default: raw.maxSteps ? String(raw.maxSteps) : "",
        validate: (v) => v.trim() === "" || (/^\d+$/.test(v.trim()) && Number(v) >= 1) || "Enter a whole number, 1 or more"
      })).trim();
      return { maxSteps: text ? Number(text) : undefined };
    }
    case "providerOptions": {
      console.log(chalk.gray('Example: {"google":{"thinkingConfig":{"includeThoughts":true}}}'));
      const text = (await input({
        message: "Provider options as JSON (empty to remove):",
        default: raw.providerOptions ? JSON.stringify(raw.providerOptions) : "",
        validate: (v) => {
          if (v.trim() === "") return true;
          try {
            const parsed = JSON.parse(v);
            return (parsed && typeof parsed === "object" && !Array.isArray(parsed)) || "Must be a JSON object";
          } catch (e: any) {
            return `Not valid JSON: ${e.message}`;
          }
        }
      })).trim();
      return { providerOptions: text ? JSON.parse(text) : undefined };
    }
    case "aiComment": {
      const on = await confirm({ message: "AI comment on?", default: raw.aiComment === true });
      return { aiComment: on ? true : undefined };
    }
    case "custom":
      console.log(chalk.gray("The custom API (URL, headers, payload template) is easiest to edit by hand in the config file."));
      return null;
    case "mcpServers":
      await editMcp(host);
      return null;
    default:
      return null;
  }
}

/** Lets you pick, type or create another configuration and switches this session to it. */
async function loadAnotherConfiguration(host: EditHost): Promise<string | null> {
  const current = getLoadedConfigFile();
  const files = listConfigFiles().filter((f) => path.resolve(f) !== (current ? path.resolve(current) : ""));

  const pick = await select({
    message: "Load which configuration?",
    choices: [
      ...files.map((f) => {
        let detail = "";
        try {
          const r = readRawConfig(f);
          detail = chalk.gray(`  ${r.provider} / ${r.model}`);
        } catch {
          // shown without details
        }
        return { name: `${tilde(f)}${detail}`, value: f };
      }),
      { name: "Enter a file path...", value: "__path" },
      { name: "Create a new configuration (setup wizard)", value: "__new" },
      { name: "Back", value: "__back" }
    ]
  });

  if (pick === "__back") return null;

  let target: string;

  if (pick === "__new") {
    const name = (
      await input({
        message: `Name for it (saved as ${tilde(path.join(GLOBAL_CONFIG_DIR, "config.<name>.json"))}):`,
        validate: (v) =>
          !/^[A-Za-z0-9_-]+$/.test(v.trim())
            ? "Use letters, numbers, - and _ only"
            : fs.existsSync(path.join(GLOBAL_CONFIG_DIR, `config.${v.trim()}.json`))
              ? "That one already exists; pick it from the list instead"
              : true
      })
    ).trim();
    target = path.join(GLOBAL_CONFIG_DIR, `config.${name}.json`);
    await runConfigWizard({ destination: target, intro: false });
    // runConfigWizard points edits at the new file; put them back until the switch is confirmed
    setLoadedConfigFile(current);
  } else if (pick === "__path") {
    const typed = (await input({ message: "Path to a config file:", validate: (v) => v.trim() !== "" || "Required" })).trim();
    target = path.resolve(process.cwd(), typed.replace(/^~(?=$|\/)/, os.homedir()));
    if (!fs.existsSync(target)) {
      console.log(chalk.red(`No such file: ${target}`));
      return null;
    }
  } else {
    target = pick;
  }

  const next = loadConfig(target);
  if (!next || !next.provider || !next.model) {
    console.log(chalk.red(`${tilde(target)} is not a usable configuration (it needs at least "provider" and "model").`));
    setLoadedConfigFile(current);
    return null;
  }

  const ok = await confirm({
    message: `Switch this session to ${tilde(target)} (${next.provider} / ${next.model})? Session flags like --yolo are reset.`,
    default: true
  });
  if (!ok) {
    setLoadedConfigFile(current);
    return null;
  }

  setLoadedConfigFile(target);
  await host.replaceConfig(next);
  console.log(chalk.green(`Now using ${tilde(target)}. Next time askgpt starts it will still use ${tilde(GLOBAL_CONFIG_FILE)} unless you run it with --config.`));
  return target;
}
