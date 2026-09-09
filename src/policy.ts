export const modes = ["folded", "regular", "expanded"] as const;
export type Mode = (typeof modes)[number];
export function isMode(value: unknown): value is Mode {
  return modes.some((mode) => mode === value);
}
export function nextMode(mode: Mode, direction: 1 | -1): Mode {
  return modes[Math.max(0, Math.min(modes.length - 1, modes.indexOf(mode) + direction))];
}

export type Row =
  | { kind: "user" | "boundary" | "other" }
  | { kind: "assistant"; terminal: boolean; visible: boolean }
  | { kind: "tool"; name: string; failed: boolean };
export interface Summary {
  tools: number;
  hiddenTools: number;
  failures: number;
  names: Map<string, number>;
  working: boolean;
}
export interface Projection {
  hidden: Set<number>;
  summaries: Map<number, Summary>;
}

/** Derive visibility only. The source rows and their native components remain intact. */
export function project(rows: readonly Row[], mode: Mode, active: boolean): Projection {
  const result: Projection = { hidden: new Set(), summaries: new Map() };
  if (mode !== "folded") return result;
  let run: number[] = [];

  function finish(working: boolean) {
    if (!run.length) return;
    const tools = run.filter((index) => rows[index].kind === "tool");
    const assistants = run.filter((index) => rows[index].kind === "assistant");
    const lastReadable = assistants.findLast((index) => {
      const row = rows[index];
      return row.kind === "assistant" && row.visible;
    });
    const visibleTools = new Set(working ? tools.slice(-3) : []);
    for (const index of tools) if (!visibleTools.has(index)) result.hidden.add(index);
    for (const index of assistants) if (index !== lastReadable) result.hidden.add(index);
    if (tools.length) {
      const summary: Summary = {
        tools: tools.length,
        hiddenTools: tools.length - visibleTools.size,
        failures: 0,
        names: new Map(),
        working,
      };
      for (const index of tools) {
        const row = rows[index];
        if (row.kind !== "tool") continue;
        summary.names.set(row.name, (summary.names.get(row.name) ?? 0) + 1);
        if (row.failed) summary.failures++;
      }
      if (!working || summary.hiddenTools > 0) result.summaries.set(run[0], summary);
    }
    run = [];
  }

  rows.forEach((row, index) => {
    if (row.kind === "user" || row.kind === "boundary") finish(false);
    if (row.kind === "assistant" || row.kind === "tool") run.push(index);
    if (row.kind === "assistant" && row.terminal) finish(false);
  });
  finish(active);
  return result;
}
