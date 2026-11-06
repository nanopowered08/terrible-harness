import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTask, listTasks, cancelTask, recoverInterruptedTasks } from "./web/tasks.js";
import { listApprovals, resolveApproval } from "./web/approvals.js";
import { listInitiatives, createInitiative, updateInitiative, deleteInitiative } from "./web/initiatives.js";
import { startAutonomyWorker, stopAutonomyWorker } from "./web/worker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../web");
const host = process.env.ASKGPT_WEB_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.ASKGPT_WEB_PORT ?? "4173", 10);
if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("AskGPT Web currently binds to loopback only.");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ASKGPT_WEB_PORT must be a valid TCP port.");

function json(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}
async function body(req: http.IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 16000) throw new Error("Request body is too large.");
  }
  return raw ? JSON.parse(raw) : {};
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true, app: "AskGPT Web", mode: "local", taskExecution: "enabled", initiativeEngine: "enabled" }); return;
    }
    if (req.method === "GET" && url.pathname === "/api/tasks") { json(res, 200, { tasks: listTasks() }); return; }
    if (req.method === "GET" && url.pathname === "/api/approvals") { json(res, 200, { approvals: listApprovals() }); return; }
    if (req.method === "GET" && url.pathname === "/api/initiatives") { json(res, 200, { initiatives: listInitiatives() }); return; }
    if (req.method === "POST" && url.pathname === "/api/initiatives") {
      const input = await body(req) as { name?: unknown; prompt?: unknown; intervalMinutes?: unknown };
      if (typeof input.name !== "string" || typeof input.prompt !== "string" || typeof input.intervalMinutes !== "number") {
        json(res, 400, { error: "name, prompt, and intervalMinutes are required." }); return;
      }
      json(res, 201, { initiative: createInitiative(input.name, input.prompt, input.intervalMinutes) }); return;
    }
    const initiative = url.pathname.match(/^\/api\/initiatives\/([0-9a-f-]+)$/i);
    if (req.method === "PATCH" && initiative) {
      const input = await body(req) as { enabled?: unknown; intervalMinutes?: unknown };
      if (input.enabled !== undefined && typeof input.enabled !== "boolean") { json(res, 400, { error: "enabled must be a boolean." }); return; }
      if (input.intervalMinutes !== undefined && typeof input.intervalMinutes !== "number") { json(res, 400, { error: "intervalMinutes must be a number." }); return; }
      const item = updateInitiative(initiative[1], { enabled: input.enabled as boolean | undefined, intervalMinutes: input.intervalMinutes as number | undefined });
      json(res, item ? 200 : 404, { initiative: item }); return;
    }
    if (req.method === "DELETE" && initiative) {
      const ok = deleteInitiative(initiative[1]);
      json(res, ok ? 200 : 404, { ok }); return;
    }
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const input = await body(req) as { prompt?: unknown };
      if (typeof input.prompt !== "string") { json(res, 400, { error: "A string prompt is required." }); return; }
      json(res, 201, { task: createTask(input.prompt) }); return;
    }
    const approval = url.pathname.match(/^\/api\/approvals\/([0-9a-f-]+)$/i);
    if (req.method === "POST" && approval) {
      const input = await body(req) as { approved?: unknown; reason?: unknown };
      if (typeof input.approved !== "boolean") { json(res, 400, { error: "approved must be a boolean." }); return; }
      const ok = resolveApproval(approval[1], input.approved, typeof input.reason === "string" ? input.reason : undefined);
      json(res, ok ? 200 : 404, { ok }); return;
    }
    const cancel = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]+)\/cancel$/i);
    if (req.method === "POST" && cancel) {
      const task = cancelTask(cancel[1]);
      if (!task) { json(res, 409, { error: "Task not found or no longer queued." }); return; }
      json(res, 200, { task }); return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
      });
      res.end(fs.readFileSync(path.join(webRoot, "index.html"))); return;
    }
    json(res, 404, { error: "Not found." });
  } catch (error) {
    json(res, 400, { error: (error as Error).message || "Bad request." });
  }
});
server.listen(port, host, () => {
  console.log(`AskGPT Web is running at http://${host}:${port}`);
  const recovered = recoverInterruptedTasks();
  if (recovered) console.log(`Marked ${recovered} interrupted task(s) as failed for review.`);
  console.log("Autonomy worker started. Scheduled initiatives enabled; tool calls require dashboard approval unless configured otherwise.");
  startAutonomyWorker();
});
function shutdown(): void {
  stopAutonomyWorker();
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
