import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createTask } from "./tasks.js";

export interface Initiative {
  id: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: string;
  nextRunAt: string;
  lastRunAt?: string;
  lastTaskId?: string;
}
const dataDir = process.env.TERRIBLE_HARNESS_HOME ?? path.join(os.homedir(), ".terrible-harness");
const dataFile = path.join(dataDir, "initiatives.json");
function read(): Initiative[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    return Array.isArray(value) ? value as Initiative[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Could not read initiative store: ${(error as Error).message}`);
  }
}
function write(items: Initiative[]): void {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tmp = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, dataFile);
}
export function listInitiatives(): Initiative[] {
  return read().sort((a,b) => a.createdAt.localeCompare(b.createdAt));
}
export function createInitiative(name: string, prompt: string, intervalMinutes: number): Initiative {
  const cleanName = name.trim(), cleanPrompt = prompt.trim();
  if (!cleanName || cleanName.length > 100) throw new Error("Initiative name must be 1–100 characters.");
  if (!cleanPrompt || cleanPrompt.length > 4000) throw new Error("Initiative prompt must be 1–4,000 characters.");
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10080) throw new Error("Interval must be between 5 minutes and 7 days.");
  const now = new Date();
  const item: Initiative = { id: randomUUID(), name: cleanName, prompt: cleanPrompt, intervalMinutes, enabled: true, createdAt: now.toISOString(), nextRunAt: new Date(now.getTime() + intervalMinutes * 60000).toISOString() };
  write([...read(), item]);
  return item;
}
export function updateInitiative(id: string, changes: { enabled?: boolean; intervalMinutes?: number }): Initiative | null {
  const items = read(), item = items.find(x => x.id === id);
  if (!item) return null;
  if (typeof changes.enabled === "boolean") item.enabled = changes.enabled;
  if (changes.intervalMinutes !== undefined) {
    if (!Number.isInteger(changes.intervalMinutes) || changes.intervalMinutes < 5 || changes.intervalMinutes > 10080) throw new Error("Interval must be between 5 minutes and 7 days.");
    item.intervalMinutes = changes.intervalMinutes;
    item.nextRunAt = new Date(Date.now() + item.intervalMinutes * 60000).toISOString();
  }
  write(items); return item;
}
export function deleteInitiative(id: string): boolean {
  const items = read(), next = items.filter(x => x.id !== id);
  if (next.length === items.length) return false;
  write(next); return true;
}
export function runDueInitiatives(): number {
  const items = read(), now = Date.now();
  let changed = false, count = 0;
  for (const item of items) {
    if (!item.enabled || Date.parse(item.nextRunAt) > now) continue;
    // Advance the schedule before queueing to prevent duplicate launches after a restart.
    item.lastRunAt = new Date(now).toISOString();
    item.nextRunAt = new Date(now + item.intervalMinutes * 60000).toISOString();
    const task = createTask([
      "This is an autonomous, scheduled check-in. Review the request below and use available tools when appropriate.",
      "Decide whether there is genuinely useful new information to report. Do not invent changes or repeat old information.",
      "If there is nothing useful or new, respond with exactly NO_UPDATE.",
      "If there is something useful, explain the finding clearly and why it matters.",
      "",
      item.prompt
    ].join("\n"));
    item.lastTaskId = task.id;
    changed = true; count++;
  }
  if (changed) write(items);
  return count;
}
