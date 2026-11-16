// src/tools/generate_image.ts
// Lets the model generate an image with the image model set under "imageGeneration"
// in config.json, and saves it into ./images (current folder). Nothing is hardcoded:
// model, provider, base URL and key all come from the config (or env).
// Set it up with /edit cfg. Until then the tool exists but tells the model to
// redirect the user there.
//
//   "imageGeneration": { "provider": "google", "model": "<model id>", "apiKey": "...", "baseURL": "..." }
//
// The model only ever sees the saved file paths, never the base64.

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { tool, jsonSchema } from "ai";
import { confirmTool, rejectionMessage } from "./confirm.js";
import { sniffImage } from "../attachments.js";
import type { ImageGenerationConfig } from "../types.js";

const IMAGE_DIR = "images";
const TIMEOUT_MS = 120_000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

// Public endpoints, only used when baseURL isn't set in the config.
const DEFAULT_BASE: Record<ImageGenerationConfig["provider"], string> = {
  google: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1"
};

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg"
};

function resolveKey(cfg: ImageGenerationConfig): string | undefined {
  if (cfg.apiKey) return cfg.apiKey;
  if (process.env.IMAGE_API_KEY) return process.env.IMAGE_API_KEY;
  if (cfg.provider === "google") return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (cfg.provider === "openrouter") return process.env.OPENROUTER_API_KEY;
  return process.env.OPENAI_API_KEY;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
}

interface RawImage { data: Buffer; mime?: string }

async function requestGoogle(cfg: ImageGenerationConfig, key: string, prompt: string, signal: AbortSignal) {
  const base = (cfg.baseURL || DEFAULT_BASE.google).replace(/\/+$/, "");
  const res = await fetch(`${base}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    }),
    signal
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const data: any = await res.json();
  const cand = data?.candidates?.[0];
  const images: RawImage[] = [];
  const texts: string[] = [];
  for (const part of cand?.content?.parts ?? []) {
    if (part?.text) texts.push(part.text);
    const inline = part?.inlineData ?? part?.inline_data;
    if (inline?.data) {
      images.push({ data: Buffer.from(inline.data, "base64"), mime: inline.mimeType ?? inline.mime_type });
    }
  }
  const why = cand?.finishReason ?? data?.promptFeedback?.blockReason;
  return { images, text: texts.join("\n").trim(), why };
}

// OpenAI-style image endpoints: OpenAI is POST /images/generations, OpenRouter is POST /images.
// Both answer { data: [{ b64_json | url, media_type? }] }.
async function requestImagesApi(cfg: ImageGenerationConfig, key: string, prompt: string, signal: AbortSignal) {
  const base = (cfg.baseURL || DEFAULT_BASE[cfg.provider]).replace(/\/+$/, "");
  const endpoint = cfg.provider === "openrouter" ? "images" : "images/generations";
  const res = await fetch(`${base}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: cfg.model, prompt, n: 1 }),
    signal
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const data: any = await res.json();
  const images: RawImage[] = [];
  for (const item of data?.data ?? []) {
    if (item?.b64_json) {
      images.push({ data: Buffer.from(item.b64_json, "base64"), mime: item.media_type });
    } else if (item?.url) {
      const img = await fetch(item.url, { signal });
      if (!img.ok) throw new Error(`could not download image (HTTP ${img.status})`);
      images.push({ data: Buffer.from(await img.arrayBuffer()), mime: img.headers.get("content-type") ?? undefined });
    }
  }
  return { images, text: "", why: undefined as string | undefined };
}

export const NOT_SET_UP_MESSAGE =
  "User hasn't set up this tool yet. Redirect them to editing the config via /edit cfg.";

export function createGenerateImageTool(cfg: ImageGenerationConfig | undefined, autoApprove: boolean) {
  const configured = Boolean(cfg && cfg.provider && typeof cfg.model === "string" && cfg.model.trim());
  return tool({
    description:
      `Generate an image from a text prompt using the user's configured image model${configured ? ` (${cfg!.model})` : " (not set up yet)"}. ` +
      `The image is saved into the images/ folder of the current directory and the saved file path is returned. ` +
      `Write a detailed, concrete prompt.`,
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed description of the image to generate" }
      },
      required: ["prompt"]
    }),
    execute: async (args: any, execOptions: any) => {
      if (!cfg || !configured) return { success: false, error: NOT_SET_UP_MESSAGE };

      const prompt = args?.prompt || args?.description || "";
      if (typeof prompt !== "string" || !prompt.trim()) return { success: false, error: "A prompt is required." };

      const key = resolveKey(cfg);
      if (!key) {
        return {
          success: false,
          error: "No API key is set for image generation. Redirect the user to editing the config via /edit cfg (Image generation), or setting IMAGE_API_KEY."
        };
      }

      const verdict = await confirmTool({
        question: `Generate an image with ${cfg.model}?`,
        autoApprove,
        preview: () => console.log(chalk.cyan(`[Image] ${cfg.model}: `) + chalk.gray(prompt.slice(0, 500)))
      });
      if (!verdict.approved) return { success: false, rejected: true, error: rejectionMessage(verdict, "image generation") };

      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const signal = execOptions?.abortSignal ? AbortSignal.any([timeout, execOptions.abortSignal]) : timeout;

      let result;
      try {
        result = cfg.provider === "google"
          ? await requestGoogle(cfg, key, prompt, signal)
          : await requestImagesApi(cfg, key, prompt, signal);
      } catch (err: any) {
        return { success: false, error: err?.name === "TimeoutError" ? "Image request timed out." : err?.message ?? String(err) };
      }

      if (result.images.length === 0) {
        return {
          success: false,
          error: `The model returned no image${result.why ? ` (${result.why})` : ""}.${result.text ? ` It said: ${result.text.slice(0, 300)}` : ""}`
        };
      }

      const dir = path.resolve(process.cwd(), IMAGE_DIR);
      fs.mkdirSync(dir, { recursive: true });
      const stamp = Date.now();
      const files: string[] = [];
      for (const [i, img] of result.images.entries()) {
        if (img.data.length > MAX_IMAGE_BYTES) return { success: false, error: "Returned image is too large." };
        const mime = sniffImage(img.data) ?? img.mime ?? "image/png";
        const name = `${stamp}-${slug(prompt)}${i ? `-${i + 1}` : ""}.${EXT[mime] ?? "png"}`;
        const full = path.join(dir, name);
        fs.writeFileSync(full, img.data);
        files.push(path.relative(process.cwd(), full));
      }
      console.log(chalk.cyan(`[Image] saved ${files.join(", ")}`));
      return { success: true, files, model: cfg.model, ...(result.text ? { text: result.text } : {}) };
    }
  });
}
