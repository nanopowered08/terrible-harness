import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { sniffImage } from "../attachments.js";

export type TaskStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export interface TaskImageInfo { name: string; mediaType: string; bytes: number }
export interface AgentTask {
  id: string; prompt: string; status: TaskStatus; createdAt: string; updatedAt: string;
  result?: string; error?: string; images?: TaskImageInfo[];
}
/** Images attached to a task, as received from the dashboard (raw bytes, already decoded). */
export interface TaskImageInput { name: string; data: Buffer }
export const MAX_TASK_IMAGES = 4;
export const MAX_TASK_IMAGE_BYTES = 10 * 1024 * 1024;
const dataDir = process.env.TERRIBLE_HARNESS_HOME ?? path.join(os.homedir(), ".terrible-harness");
const dataFile = path.join(dataDir, "tasks.json");
const imageRoot = path.join(dataDir, "task-images");
const taskImagePath = (id: string, index: number) => path.join(imageRoot, id, String(index));

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
export function createTask(prompt: string, images: TaskImageInput[] = []): AgentTask {
  const clean = prompt.trim();
  if (!clean && !images.length) throw new Error("Task description cannot be empty.");
  if (clean.length > 4000) throw new Error("Task description must be 4,000 characters or fewer.");
  if (images.length > MAX_TASK_IMAGES) throw new Error(`Attach at most ${MAX_TASK_IMAGES} images.`);
  const checked: TaskImageInfo[] = images.map((image, i) => {
    const name = path.basename(image.name || `image-${i + 1}`).slice(0, 80);
    if (image.data.length > MAX_TASK_IMAGE_BYTES) throw new Error(`${name} is over 10 MB.`);
    const mediaType = sniffImage(image.data);
    if (!mediaType) throw new Error(`${name} is not a jpg/png/gif/webp image.`);
    return { name, mediaType, bytes: image.data.length };
  });
  const id = randomUUID();
  if (images.length) {
    fs.mkdirSync(path.join(imageRoot, id), { recursive: true, mode: 0o700 });
    images.forEach((image, i) => fs.writeFileSync(taskImagePath(id, i), image.data, { mode: 0o600 }));
  }
  const now = new Date().toISOString();
  const task: AgentTask = { id, prompt: clean, status: "queued", createdAt: now, updatedAt: now, ...(checked.length ? { images: checked } : {}) };
  writeTasks([...readTasks(), task]);
  return task;
}
/** Bytes + type of one attached image, or null if the task/index doesn't exist. */
export function readTaskImage(id: string, index: number): { data: Buffer; mediaType: string; name: string } | null {
  const info = readTasks().find(task => task.id === id)?.images?.[index];
  if (!info) return null;
  try { return { data: fs.readFileSync(taskImagePath(id, index)), mediaType: info.mediaType, name: info.name }; }
  catch { return null; }
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
