import { contextDelta, duration, mergeFiles, type ActivityStat, type FileStat } from "./stats.ts";

// Keep the saved value compatible with the original three-mode release.
export const modes = ["folded", "regular", "expanded"] as const;
export type Mode = (typeof modes)[number];
export function modeLabel(mode: Mode): string { return mode === "folded" ? "collapsed" : mode; }
export function isMode(value: unknown): value is Mode {
  return modes.some((mode) => mode === value);
}
export function nextMode(mode: Mode, direction: 1 | -1): Mode {
  return modes[Math.max(0, Math.min(modes.length - 1, modes.indexOf(mode) + direction))];
}

export type Row = (
  | { kind: "user" | "boundary" | "other" }
  | { kind: "assistant"; terminal: boolean; visible: boolean; readable?: boolean; streaming?: boolean }
  | { kind: "tool"; name: string; failed: boolean; running?: boolean }
) & ActivityStat;
export interface Summary {
  tools: number;
  messages: number;
  failures: number;
  working: boolean;
  durationMs?: number;
  tokens?: number;
  files: FileStat[];
}
export interface Projection {
  hidden: Set<number>;
  summaries: Map<number, Summary>;
  /** Native assistant rendering is retained only for the current response. */
  currentAssistant?: number;
  thinking: boolean;
}

/** Derive visibility only. The source rows and their native components remain intact. */
export function project(rows: readonly Row[], mode: Mode, active: boolean, now = Date.now()): Projection {
  const result: Projection = { hidden: new Set(), summaries: new Map(), thinking: false };
  if (mode !== "folded") return result;
  let run: number[] = [];
  let turnHasSummary = false;
  const isReadable = (index: number) => {
    const row = rows[index];
    return row.kind === "assistant" && (row.readable ?? row.visible);
  };

  function finish(working: boolean, forceSummary = false, boundary?: number) {
    if (!run.length) return;
    const tools = run.filter((index) => rows[index].kind === "tool");
    const assistants = run.filter((index) => rows[index].kind === "assistant");
    const streaming = working ? assistants.findLast((index) => {
      const row = rows[index];
      return row.kind === "assistant" && row.streaming;
    }) : undefined;
    const running = working ? tools.findLast((index) => {
      const row = rows[index];
      return row.kind === "tool" && row.running;
    }) : undefined;
    for (const index of tools) if (index !== running) result.hidden.add(index);
    for (const index of assistants) {
      if (!isReadable(index) && index !== streaming) result.hidden.add(index);
    }
    if (working) {
      result.currentAssistant = streaming;
      // A response may be waiting on the provider with no message or tokens yet.
      const row = streaming === undefined ? undefined : rows[streaming];
      result.thinking = running === undefined && !(row?.kind === "assistant" && row.visible);
    }

    const hasHiddenActivity = tools.length > 0 || assistants.some((index) => !isReadable(index));
    if (hasHiddenActivity || (working && !turnHasSummary) || forceSummary) {
      // Place the summary after the prose that initiated this activity. Prefix
      // activity and text-only turns retain the established before-message layout.
      const first = run[0];
      const anchor = isReadable(first)
        ? run.find((index) => index !== first && (rows[index].kind === "tool" || !isReadable(index))) ?? first
        : first;
      // The next prose response closes the preceding tool block. Use it as the
      // timing/token boundary without counting or hiding it in both segments.
      const stats = [...run, ...(boundary === undefined ? [] : [boundary])].map((index) => rows[index]);
      result.summaries.set(anchor, {
        tools: tools.length,
        messages: assistants.length,
        failures: tools.filter((index) => rows[index].kind === "tool" && rows[index].failed).length,
        working,
        durationMs: duration(stats, working, now),
        tokens: contextDelta(stats),
        files: mergeFiles(stats),
      });
      turnHasSummary = true;
    }
    run = [];
  }

  rows.forEach((row, index) => {
    if (row.kind === "user" || row.kind === "boundary") {
      finish(false, !turnHasSummary);
      turnHasSummary = false;
    }
    // Readable prose starts a new activity segment. This keeps the tools it
    // initiated summarized between it and the model's next prose message.
    if (row.kind === "assistant" && (row.readable ?? row.visible) && run.length) finish(false, false, index);
    if (row.kind === "assistant" || row.kind === "tool") run.push(index);
    if (row.kind === "assistant" && row.terminal) {
      finish(false, !turnHasSummary);
      turnHasSummary = false;
    }
  });
  const pending = run.length > 0;
  finish(active, !active && !turnHasSummary);
  if (active && !pending) result.thinking = true;
  return result;
}
