// src/tool-memory.ts
// .context.json only stores message text, so the model used to forget every
// tool call and result between turns (re-listing directories, re-reading
// files). These helpers turn each tool call into one short line that gets
// saved with the assistant's reply.

const MAX_FILE_CHARS = 1500;   // read_file content kept per call
const MAX_CMD_CHARS = 500;     // command stdout / stderr kept per call
const MAX_ERR_CHARS = 300;     // error / rejection text kept per call

function cut(text: unknown, max: number): string {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  return s.length > max ? `${s.slice(0, max)}... (cut, ${s.length} chars total)` : s;
}

/** Text parts of an MCP-style result ({ content: [{ type: "text", text }] }), if any. */
function textOf(output: any): string | null {
  if (!Array.isArray(output?.content)) return null;
  const text = output.content
    .filter((p: any) => p?.type === "text" && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("\n");
  return text || null;
}

export function summarizeToolCall(name: string, input: any, output: any): string {
  const arg = input ?? {};
  const path = arg.filePath ?? arg.path ?? arg.file ?? "";

  switch (name) {
    case "read_file": {
      if (output?.success === false) return `read_file ${path}: failed (${cut(output.error, MAX_ERR_CHARS)})`;
      const ranged = arg.startLine !== undefined || arg.endLine !== undefined;
      const body = String(output?.content ?? "");
      return `read_file ${path}${ranged ? " (partial)" : ""}:\n${cut(body, MAX_FILE_CHARS)}`;
    }
    case "write_file": {
      if (output?.rejected) return `write_file ${path}: REJECTED by user, file not changed (${cut(output.error, MAX_ERR_CHARS)})`;
      if (output?.needsRead) return `write_file ${path}: refused, read it first`;
      if (output?.success === false) return `write_file ${path}: failed (${cut(output.error, MAX_ERR_CHARS)})`;
      if (output?.unchanged) return `write_file ${path}: no change (content identical)`;
      return `write_file ${path}: written${arg.append ? " (append)" : ""}, ${output?.bytesWritten ?? "?"} bytes`;
    }
    case "execute_command": {
      const cmd = cut(arg.command ?? arg.cmd ?? "", 200);
      if (output?.rejected) return `execute_command \`${cmd}\`: REJECTED by user, not run`;
      const out = String(output?.stdout ?? "").trim();
      const err = String(output?.stderr ?? "").trim();
      return (
        `execute_command \`${cmd}\`: exit ${output?.exitCode ?? "?"}` +
        (out ? `\nstdout: ${cut(out, MAX_CMD_CHARS)}` : "") +
        (err ? `\nstderr: ${cut(err, MAX_CMD_CHARS)}` : "")
      );
    }
    case "search_web":
      return `search_web "${cut(arg.query ?? output?.query ?? "", 120)}": ${Array.isArray(output?.results) ? output.results.length : "?"} results`;
    case "open_webpage":
      return `open_webpage ${cut(arg.url ?? "", 200)}: ${output?.error ? `failed (${cut(output.error, MAX_ERR_CHARS)})` : "opened"}`;
    default: {
      const args = cut(JSON.stringify(arg), 160);
      if (output?.rejected) return `${name} ${args}: REJECTED by user, not run`;
      if (output?.error || output?.success === false || output?.isError) {
        const detail = output?.error ?? textOf(output) ?? "error";
        return `${name} ${args}: failed (${cut(detail, MAX_ERR_CHARS)})`;
      }
      const text = textOf(output);
      return `${name} ${args}: ${text ? cut(text, MAX_FILE_CHARS) : "done"}`;
    }
  }
}

/** The text saved to .context.json: tool notes first, then what the assistant said. */
export function withToolNotes(records: string[], assistantText: string): string {
  if (!records.length) return assistantText;
  const notes = records.map((r) => `- ${r}`).join("\n");
  return (
    `[Harness record of tools used in this turn. Already done, do not repeat them unless needed, and do not write notes like this yourself.]\n${notes}\n[End of record]\n\n` +
    assistantText
  );
}
