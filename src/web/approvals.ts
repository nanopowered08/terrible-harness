import { randomUUID } from "node:crypto";
import type { Verdict } from "../tools/confirm.js";

export interface PendingApproval {
  id: string;
  taskId: string;
  question: string;
  createdAt: string;
}
const pending = new Map<string, { item: PendingApproval; resolve: (verdict: Verdict) => void }>();

export function requestApproval(taskId: string, question: string): Promise<Verdict> {
  return new Promise(resolve => {
    const id = randomUUID();
    pending.set(id, { item: { id, taskId, question, createdAt: new Date().toISOString() }, resolve });
  });
}
export function listApprovals(): PendingApproval[] {
  return [...pending.values()].map(entry => entry.item);
}
export function resolveApproval(id: string, approved: boolean, reason?: string): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  entry.resolve({ approved, reason });
  return true;
}
export function rejectAllApprovals(reason = "AskGPT Web stopped."): void {
  for (const [id, entry] of pending) {
    pending.delete(id);
    entry.resolve({ approved: false, reason });
  }
}
