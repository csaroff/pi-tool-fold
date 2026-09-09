import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isMode, type Mode } from "./policy.ts";

export function loadMode(path: string): Mode {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return isMode(data?.mode) ? data.mode : "folded";
  } catch {
    return "folded";
  }
}

/** Only explicit selections write this file; old sessions cannot overwrite on exit. */
export function saveMode(path: string, mode: Mode): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ mode }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
