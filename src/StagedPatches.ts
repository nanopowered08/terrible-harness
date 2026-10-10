/**
 * StagedPatches.ts
 *
 * This file is only a STAGE. It does not change src/repl.ts or
 * src/providers/ai-sdk.ts by itself.
 * It holds the helper code, and the comments below say exactly where in
 * src/repl.ts each patch goes. Apply them in order, then delete the comments.
 *
 * Fixes:
 *  A) The "Y" typed at the Authorize prompt was also read by the main
 *     readline and sent to the model as a user message, and extra empty
 *     lines printed a prompt in the middle of the reply.
 *  B) Ctrl+C during generation printed "[Interrupted]" but the stream kept
 *     going, so you got a double prompt and leftover output.
 *
 * Import style: your other imports use ".js" (tsup/ESM), so import this
 * as "./StagedPatches.js" even though the file is .ts.
 */

// ---------------------------------------------------------------------------
// HELPERS (these are the real code; repl.ts imports them)
// ---------------------------------------------------------------------------

/**
 * Turn guard. While a turn is running (model streaming, tool calls,
 * Authorize prompts) any "line" event from the main readline is dropped.
 * Only affects "line" events: the keypress listener (Ctrl+T / Ctrl+C)
 * is separate, so interrupting still works.
 */
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

/**
 * Interrupt controller. One AbortController per turn.
 * Ctrl+C calls abort(); the stream gets signal and actually stops.
 */
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

/** True for the errors thrown when a request is aborted. */
export function isAbortError(err: unknown): boolean {
  const e = err as any;
  return (
    e?.name === "AbortError" ||
    e?.name === "ResponseAborted" ||
    e?.name === "ExitPromptError" || // Ctrl+C pressed at the Authorize prompt
    /abort/i.test(String(e?.message ?? ""))
  );
}

// ---------------------------------------------------------------------------
// PATCH 1: imports in src/repl.ts
// Where: top of the file, after the line
//   import { getTools } from "./tools/index.js";
// Add:
//   import { createTurnGuard, createInterrupt, isAbortError } from "./StagedPatches.js";
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 2: create the guard and interrupt objects
// Where: inside startRepl(), right after the line
//   readline.emitKeypressEvents(process.stdin, rl);
// Add:
//   const turn = createTurnGuard();
//   const interrupt = createInterrupt();
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 3: wrap the line handler (fixes bug A)
// Where: the line
//   rl.on("line", async (line) => {
// Change it to:
//   const handleLine = async (line: string) => {
// Then find the matching end of that handler, which is the line
//   });
// just above
//   rl.on("close", () => {
// and change that `});` to `};`
// Then add this right after it (before rl.on("close", ...)):
//   rl.on("line", async (line) => {
//     await turn.run(() => handleLine(line)); // dropped while a turn is running
//   });
// Nothing else in the body changes. Your existing finally { rl.resume();
// askNext(); } still prints the prompt once, after the reply finishes.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 4: reset the interrupt at the start of every turn
// Where: in handleLine, right after the line
//   const reasoningManager = new ReasoningManager(thinkingVisible, config.model);
// Add:
//   interrupt.reset();
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 5: Ctrl+C really stops the stream (fixes bug B)
// Where: in onKeypressDuringStream, the branch
//   } else if (key && key.ctrl && key.name === "c") {
// Replace its whole body with:
//     process.stdout.write("\n" + chalk.yellow("[Interrupted by user]\n"));
//     interrupt.abort();   // the finally block restores the terminal and prompts once
// (Remove the setRawMode / rl.resume() / askNext() lines from that branch.
//  The finally block already does all three.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 6: pass the signal to the model call
// Where: in handleLine, both calls inside the try block.
//   streamChatResponse({ ... })      add:   abortSignal: interrupt.signal,
//   executeCustomApi(...)            add the signal as a last argument if you
//                                    want custom providers to be interruptible
//                                    (optional, skip for now)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 7: don't show an abort as an error
// Where: src/repl.ts, the catch block
//   } catch (err: any) {
//     console.error(chalk.red(`\nError: ${err.message}\n`));
// Change to:
//   } catch (err: any) {
//     if (!isAbortError(err)) {
//       console.error(chalk.red(`\nError: ${err.message}\n`));
//     }
// Note: in ai-sdk.ts an abort usually ends the stream normally instead of
// throwing (see PATCH 8d), so the partial reply is returned and your existing
// code saves it to .context.json. This catch mostly matters for Ctrl+C at the
// Authorize prompt, where inquirer throws ExitPromptError.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PATCH 8: src/providers/ai-sdk.ts (abort support)
// Apply all five parts (a to e).
//
// 8a. Where: the interface
//       export interface StreamResponseOptions {
//     after the line
//       onContentChunk?: (chunk: string) => void;
//     Add:
//       abortSignal?: AbortSignal;
//
// 8b. Where: the first line inside streamChatResponse:
//       const { config, messages, systemPrompt, reasoningManager, enableTools = true, onContentChunk } = options;
//     Change to:
//       const { config, messages, systemPrompt, reasoningManager, enableTools = true, onContentChunk, abortSignal } = options;
//
// 8c. Where: the streamText({ ... }) call, the last property
//       stopWhen: isStepCount(10)
//     Change to:
//       stopWhen: isStepCount(10),
//       abortSignal
//
// 8d. Where: the loop
//       for await (const part of stream.fullStream) {
//         const partType = part.type;
//     Add right after the `const partType = part.type;` line:
//         if (abortSignal?.aborted || (partType as string) === "abort") break;
//     (Newer AI SDK versions emit an "abort" part instead of throwing, which
//      is why this checks both. The cast avoids a TS union error.)
//
// 8e. Where: the error branch
//       } else if (partType === "error") {
//         console.error(chalk.red(`\nStream Error: ${(part as any).error}`));
//     Change the console.error line to:
//         if (!abortSignal?.aborted) {
//           console.error(chalk.red(`\nStream Error: ${(part as any).error}`));
//         }
//     (Aborting can surface an error part; this keeps Ctrl+C quiet.)
//
// Nothing else in ai-sdk.ts changes. Tool execution itself is not cancelled
// by this: a command already running finishes, and the stream stops after it.
// ---------------------------------------------------------------------------
