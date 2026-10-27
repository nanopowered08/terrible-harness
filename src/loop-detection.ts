import type { StopCondition } from "ai";
import chalk from "chalk";

const REPETITIONS = 3;
const MAX_PATTERN_LENGTH = 3;

function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
      )
      .join(",")}}`;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function getStepSignature(step: any): string | null {
  const calls = step.toolCalls ?? [];

  if (calls.length === 0) {
    return null;
  }

  return stableStringify(
    calls.map((call: any) => ({
      tool: call.toolName ?? "unknown",
      input: call.input ?? call.args ?? call.parameters ?? null
    }))
  );
}

function findRepeatedPattern(signatures: string[]): {
  patternLength: number;
  repetitions: number;
} | null {
  const count = signatures.length;

  for (
    let patternLength = 1;
    patternLength <= Math.min(MAX_PATTERN_LENGTH, Math.floor(count / REPETITIONS));
    patternLength++
  ) {
    const start = count - patternLength * REPETITIONS;
    const pattern = signatures.slice(start, start + patternLength);

    let matches = true;

    for (let repetition = 1; repetition < REPETITIONS; repetition++) {
      const offset = start + repetition * patternLength;

      for (let i = 0; i < patternLength; i++) {
        if (signatures[offset + i] !== pattern[i]) {
          matches = false;
          break;
        }
      }

      if (!matches) break;
    }

    if (matches) {
      return { patternLength, repetitions: REPETITIONS };
    }
  }

  return null;
}

export function createLoopDetectionCondition(
  onDetected?: (message: string) => void
): StopCondition<any, any> {
  let reported = false;

  return ({ steps }) => {
    if (reported) return true;

    // Examine only the latest nine tool-bearing steps.
    const signatures = steps
      .map(getStepSignature)
      .filter((signature): signature is string => signature !== null)
      .slice(-9);

    const repeated = findRepeatedPattern(signatures);

    if (!repeated) return false;

    reported = true;

    const message =
      `Repeated tool-call pattern detected across ` +
      `${repeated.patternLength} step(s), repeated ` +
      `${repeated.repetitions} times.`;

    console.log(chalk.yellow(`\n[Loop Detection] ${message}`));
    console.log(
      chalk.gray("Stopping the current tool loop to prevent repeated work.")
    );

    onDetected?.(message);
    return true;
  };
}
