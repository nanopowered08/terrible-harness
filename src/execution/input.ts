
import { extractImage } from "../attachments.js";

export async function readStdin(): Promise<Buffer> {
  if (process.stdin.isTTY) return Buffer.alloc(0);

  const chunks: Buffer[] = [];

  try {
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
  } catch {
    // Preserve the existing behavior for now.
  }

  return Buffer.concat(chunks);
}

export async function resolveInput(promptArgs: string[]) {
  const stdinBuf = await readStdin();
  const image = extractImage(stdinBuf);
  const stdinContent = image ? "" : stdinBuf.toString("utf8").trim();

  let finalPrompt = "";

  if (stdinContent && promptArgs.length > 0) {
    finalPrompt = `${promptArgs.join(" ")}\n\n[Piped Input]:\n${stdinContent}`;
  } else if (stdinContent) {
    finalPrompt = stdinContent;
  } else if (promptArgs.length > 0) {
    finalPrompt = promptArgs.join(" ");
  } else if (image) {
    finalPrompt = "Describe this image.";
  }

  return { image, finalPrompt };
}
