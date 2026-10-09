import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Img { data: Buffer; mediaType: string; name: string }

export function sniffImage(b: Buffer): string | null {
  const s = (a: number, e: number) => b.subarray(a, e).toString("latin1");
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (s(1, 4) === "PNG") return "image/png";
  if (s(0, 3) === "GIF") return "image/gif";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "image/webp";
  return null;
}

// Accepts raw image bytes OR base64 text of an image
export function extractImage(b: Buffer): { data: Buffer; mediaType: string } | null {
  let mt = sniffImage(b);
  if (mt) return { data: b, mediaType: mt };
  const head = b.subarray(0, 200).toString("utf8");
  if (/^[A-Za-z0-9+/=\s]+$/.test(head)) {
    const decoded = Buffer.from(b.toString("utf8").trim(), "base64");
    mt = sniffImage(decoded);
    if (mt) return { data: decoded, mediaType: mt };
  }
  return null;
}

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_FILE = 200 * 1024;

const expand = (p: string) =>
  path.resolve(p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p);

/** Pulls /image=... and /file=... out of a prompt. Files are inlined as text. */
export function parseAttachments(input: string): { text: string; images: Img[] } {
  const re = /\/(image|file)=("[^"]+"|'[^']+'|\S+)/g;
  const images: Img[] = [];
  let fileText = "";

  for (const m of input.matchAll(re)) {
    const p = expand(m[2].replace(/^["']|["']$/g, ""));
    const name = path.basename(p);
    if (!fs.existsSync(p)) throw new Error(`${m[1]} not found: ${p}`);
    const buf = fs.readFileSync(p);

    if (m[1] === "image") {
      if (buf.length > MAX_IMAGE) throw new Error(`${name} is over 10 MB`);
      const mediaType = sniffImage(buf);
      if (!mediaType) throw new Error(`${name} is not a jpg/png/gif/webp`);
      images.push({ data: buf, mediaType, name });
    } else {
      if (buf.length > MAX_FILE) throw new Error(`${name} is over 200 KB`);
      fileText += `\n\n[File: ${name}]\n${buf.toString("utf8")}\n[End of ${name}]`;
    }
  }

  const prompt = input.replace(re, "").trim();
  return { text: (prompt + fileText).trim(), images };
}

/** stored = goes in .context.json, content = what the model actually gets */
export function buildUserMessage(text: string, images: Img[]) {
  if (!images.length) return { stored: text, content: text as string | any[] };
  const prompt = text || "Describe this image.";
  const marks = images.map(i => `[image attached: ${i.name}, ${i.mediaType}, ${i.data.length} bytes]`).join("\n");
  return {
    stored: `${prompt}\n${marks}`,
    content: [
      { type: "text", text: prompt },
      ...images.map(i => ({ type: "image", image: i.data, mediaType: i.mediaType })),
    ] as string | any[],
  };
}
