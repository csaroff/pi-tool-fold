import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export interface FileStat { path: string; added: number; removed: number }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ActivityStat {
  startedAt?: number;
  endedAt?: number;
  usage?: Usage;
  file?: FileStat;
}

/** Count only changed lines inside unified-patch hunks, never headers or context. */
export function editStat(name: string, args: unknown, result: unknown, cwd: string): FileStat | undefined {
  if (name !== "edit" || !args || typeof args !== "object" || !result || typeof result !== "object") return;
  const { path } = args as { path?: unknown };
  const { isError, details } = result as { isError?: boolean; details?: { patch?: unknown; diff?: unknown } };
  if (isError || typeof path !== "string" || !details) return;
  let added = 0;
  let removed = 0;
  if (typeof details.patch === "string") {
    let inHunk = false;
    for (const line of details.patch.split("\n")) {
      if (line.startsWith("@@ ")) { inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  } else if (typeof details.diff === "string") {
    // Older edit results use Pi's numbered display diff rather than a patch.
    for (const line of details.diff.split("\n")) {
      if (/^\+\s*\d+\s/.test(line)) added++;
      else if (/^-\s*\d+\s/.test(line)) removed++;
    }
  } else return;
  const expanded = path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
  return { path: isAbsolute(expanded) ? expanded : resolve(cwd, expanded), added, removed };
}

export function mergeFiles(stats: readonly ActivityStat[]): FileStat[] {
  const files = new Map<string, FileStat>();
  for (const { file } of stats) {
    if (!file) continue;
    const total = files.get(file.path) ?? { path: file.path, added: 0, removed: 0 };
    total.added += file.added;
    total.removed += file.removed;
    files.set(file.path, total);
  }
  return [...files.values()];
}

/** Context growth, not the sum of repeatedly billed input tokens. */
export function contextDelta(stats: readonly ActivityStat[]): number | undefined {
  const usages = stats.flatMap(({ usage }) => usage ? [usage] : []);
  if (!usages.length) return;
  const prompt = (usage: Usage) => usage.input + usage.cacheRead + usage.cacheWrite;
  const first = usages[0];
  const last = usages.at(-1)!;
  if (prompt(first) <= 0 || prompt(last) <= 0) return;
  return prompt(last) + last.output - prompt(first);
}

export function duration(stats: readonly ActivityStat[], working: boolean, now: number): number | undefined {
  const start = stats.find(({ startedAt }) => startedAt !== undefined)?.startedAt;
  const end = working ? now : stats.findLast(({ endedAt }) => endedAt !== undefined)?.endedAt;
  if (start === undefined || end === undefined) return;
  return Math.max(0, end - start);
}
export function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}
export function formatTokens(tokens: number): string {
  const value = Math.abs(tokens);
  const compact = value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value);
  return `${tokens < 0 ? "−" : "+"}${compact}`;
}
export function formatDiff(added: number, removed: number): string {
  return [added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean).join(" ") || "+0";
}
export function displayPath(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}
