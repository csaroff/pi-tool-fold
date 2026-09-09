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
session.appendMessage({ role: "user", content: "Inspect five files", timestamp: Date.now() });
const base = {
  role: "assistant" as const, api: "openai-responses" as const, provider: "openai", model: "gpt-4.1", timestamp: Date.now(),
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};
for (let index = 0; index < 5; index++) {
  session.appendMessage({ ...base, stopReason: "toolUse", content: [
    { type: "text", text: `Checking file ${index}.` },
    { type: "toolCall", id: `call-${index}`, name: "bash", arguments: { command: `echo TOOL_${index}` } },
  ] });
  session.appendMessage({ role: "toolResult", toolCallId: `call-${index}`, toolName: "bash", isError: false, timestamp: Date.now(), content: [
    { type: "text", text: Array.from({ length: 30 }, (_, line) => `RESULT_${index}_${line}`).join("\n") },
  ] });
}
session.appendMessage({ ...base, stopReason: "stop", content: [{ type: "text", text: "All five files checked. FINAL_RESPONSE" }] });
console.log(session.getSessionFile());
