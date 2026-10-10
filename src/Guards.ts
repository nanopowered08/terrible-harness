// Guards extra stdin

export function createTurnGuard() {
  let busy = false;
  return {
    get busy(): boolean {
      return busy;
    },
    /** Runs fn unless a turn is already running. Returns false if dropped. */
    async run(fn: () => Promise<void>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try {
        await fn();
      } finally {
        busy = false;
      }
      return true;
    },
  };
}

// Abort

export function createInterrupt() {
  let controller = new AbortController();
  return {
    get signal(): AbortSignal {
      return controller.signal;
    },
    get aborted(): boolean {
      return controller.signal.aborted;
    },
    /** Call at the start of every turn. */
    reset(): void {
      controller = new AbortController();
    },
    abort(): void {
      controller.abort();
    },
  };
}

// Errors for abort

export function isAbortError(err: unknown): boolean {
  const e = err as any;
  return (
    e?.name === "AbortError" ||
    e?.name === "ResponseAborted" ||
    e?.name === "ExitPromptError" || // Ctrl+C pressed at the Authorize prompt
    /abort/i.test(String(e?.message ?? ""))
  );
}
