import { loadConfig } from "../config.js";
import { executeOneShot } from "../execution/one-shot.js";
import { closeMcpClients } from "../tools/mcp.js";
import { setToolApprovalHandler } from "../tools/confirm.js";
import { requestApproval, rejectAllApprovals } from "./approvals.js";
import { listTasks, updateTask } from "./tasks.js";
import { runDueInitiatives } from "./initiatives.js";

let started = false;
let stopped = false;
let currentTaskId: string | null = null;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function startAutonomyWorker(): void {
  if (started) return;
  started = true;
  stopped = false;
  void supervise();
}
async function supervise(): Promise<void> {
  while (!stopped) {
    try {
      const launched = runDueInitiatives();
      if (launched) console.log(`Initiative engine queued ${launched} scheduled check(s).`);
    } catch (error) {
      console.error("[Initiative engine]", error);
    }
    const task = listTasks().find(item => item.status === "queued");
    if (!task) { await sleep(5000); continue; }
    currentTaskId = task.id;
    const config = loadConfig();
    if (!config) {
      updateTask(task.id, { status: "failed", error: "No AskGPT configuration found. Configure a provider and API key, then restart AskGPT Web." });
      currentTaskId = null;
      continue;
    }
    updateTask(task.id, { status: "running", error: undefined, result: undefined });
    setToolApprovalHandler(async question => {
      if (stopped) return { approved: false, reason: "AskGPT Web is shutting down." };
      updateTask(task.id, { status: "waiting" });
      const verdict = await requestApproval(task.id, question);
      if (!stopped) updateTask(task.id, { status: "running" });
      return verdict;
    });
    try {
      const result = await executeOneShot(config, { image: null, finalPrompt: task.prompt } as any, true, false, { onContentChunk: () => {}, throwOnError: true });
      if (!stopped) updateTask(task.id, { status: "completed", result: result || "(Task completed without a text response.)" });
    } catch (error) {
      if (!stopped) updateTask(task.id, { status: "failed", error: (error as Error)?.message || String(error) });
    } finally {
      setToolApprovalHandler(null);
      try { await closeMcpClients(); } catch { /* cleanup must not kill the supervisor */ }
      currentTaskId = null;
    }
  }
}
export function stopAutonomyWorker(): void {
  stopped = true;
  rejectAllApprovals();
  if (currentTaskId) updateTask(currentTaskId, { status: "failed", error: "AskGPT Web stopped before this task finished." });
}
