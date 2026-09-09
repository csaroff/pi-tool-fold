// Offline transcript fixture for manual terminal checks; no provider requests.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: npx tsx test/create-session.ts <temporary-directory>");
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "settings.json"), JSON.stringify({ quietStartup: true, defaultProvider: "openai", defaultModel: "gpt-4.1", enableInstallTelemetry: false }));
const sessionDirectory = join(directory, "sessions", `--${process.cwd().replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
const session = SessionManager.create(process.cwd(), sessionDirectory);
const startedAt = Date.now() - 12 * 60 * 1000;
session.appendMessage({ role: "user", content: "Inspect five files", timestamp: startedAt });
const base = {
  role: "assistant" as const, api: "openai-responses" as const, provider: "openai", model: "gpt-4.1", timestamp: startedAt,
  usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};
for (let index = 0; index < 5; index++) {
  const name = index === 4 ? "edit" : "bash";
  const args = index === 4 ? { path: "/tmp/example.txt", edits: [{ oldText: "old", newText: "new\nextra" }] } : { command: `echo TOOL_${index}` };
  session.appendMessage({ ...base, timestamp: startedAt + index * 60000, stopReason: "toolUse", content: [
    { type: "thinking", thinking: `THINKING_${index}: deciding which file to inspect.` },
    { type: "text", text: `Checking file ${index}.` },
    { type: "toolCall", id: `call-${index}`, name, arguments: args },
  ] });
  session.appendMessage({ role: "toolResult", toolCallId: `call-${index}`, toolName: name, isError: false, timestamp: Date.now(),
    details: index === 4 ? { patch: "--- a\n+++ b\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n", diff: "-1 old\n+1 new\n+2 extra" } : undefined,
    content: [
    { type: "text", text: Array.from({ length: 30 }, (_, line) => `RESULT_${index}_${line}`).join("\n") },
  ] });
}
session.appendMessage({ ...base, timestamp: startedAt + 11 * 60000, usage: { ...base.usage, input: 5500, output: 500, totalTokens: 6000 }, stopReason: "stop", content: [
  { type: "thinking", thinking: "FINAL_THINKING: summarize what changed." },
  { type: "text", text: "All five files checked. FINAL_RESPONSE" },
] });
console.log(session.getSessionFile());
