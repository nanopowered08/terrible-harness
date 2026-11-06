import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export type TaskStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export interface AgentTask {
  id: string; prompt: string; status: TaskStatus; createdAt: string; updatedAt: string;
  result?: string; error?: string;
}
const dataDir = process.env.TERRIBLE_HARNESS_HOME ?? path.join(os.homedir(), ".terrible-harness");
const dataFile = path.join(dataDir, "tasks.json");

function readTasks(): AgentTask[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    return Array.isArray(value) ? value as AgentTask[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Could not read task store: ${(error as Error).message}`);
  }
}
function writeTasks(tasks: AgentTask[]): void {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const temporary = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(tasks, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, dataFile);
}
export function listTasks(): AgentTask[] {
  return readTasks().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export function createTask(prompt: string): AgentTask {
  const clean = prompt.trim();
  if (!clean) throw new Error("Task description cannot be empty.");
  if (clean.length > 4000) throw new Error("Task description must be 4,000 characters or fewer.");
  const now = new Date().toISOString();
  const task: AgentTask = { id: randomUUID(), prompt: clean, status: "queued", createdAt: now, updatedAt: now };
  writeTasks([...readTasks(), task]);
  return task;
}
/** Persist a terminal state for work interrupted by a previous server process. */
export function recoverInterruptedTasks(): number {
  const tasks = readTasks();
  let recovered = 0;
  for (const task of tasks) {
    if (task.status === "running" || task.status === "waiting") {
      task.status = "failed";
      task.error = "AskGPT Web stopped before this task finished. Review it before submitting again.";
      task.updatedAt = new Date().toISOString();
      recovered++;
    }
  }
  if (recovered) writeTasks(tasks);
  return recovered;
}
/** Persist task lifecycle transitions. */
export function updateTask(id: string, update: Partial<Pick<AgentTask,"status"|"result"|"error">>): AgentTask | null {
  const tasks = readTasks();
  const index = tasks.findIndex(task => task.id === id);
  if (index < 0) return null;
  const next = { ...tasks[index], ...update, updatedAt: new Date().toISOString() };
  tasks[index] = next; writeTasks(tasks); return next;
}
export function cancelTask(id: string): AgentTask | null {
  const task = readTasks().find(item => item.id === id);
  if (!task || task.status !== "queued") return null;
  return updateTask(id, { status: "cancelled" });
}
