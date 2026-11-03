// src/tools/ReadTracker.ts
// Remembers what the model has actually seen of each file during this run,
// so write_file can refuse to overwrite a file the model never read (or that
// changed on disk since it read it). In-memory only: a new run starts fresh.

const seen = new Map<string, string>(); // absolute path -> content the model last saw

export type ReadStatus = "ok" | "unread" | "stale";

export function noteContent(fullPath: string, text: string): void {
  seen.set(fullPath, text);
}

export function checkRead(fullPath: string, currentText: string): ReadStatus {
  const known = seen.get(fullPath);
  if (known === undefined) return "unread";
  return known === currentText ? "ok" : "stale";
}
