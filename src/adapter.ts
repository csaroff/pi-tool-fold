import {
  AssistantMessageComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type Theme,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { project, type Mode, type Row, type Summary } from "./policy.ts";
import { displayPath, editStat, formatDiff, formatDuration, formatTokens } from "./stats.ts";

export function describe(component: Component): Row {
  if (component instanceof UserMessageComponent || component instanceof SkillInvocationMessageComponent) {
    return { kind: "user" };
  }
  if (component instanceof CompactionSummaryMessageComponent || component instanceof BranchSummaryMessageComponent) {
    return { kind: "boundary" };
  }
  if (component instanceof ToolExecutionComponent) {
    const name: unknown = Reflect.get(component, "toolName");
    const result = Reflect.get(component, "result");
    const toolName = typeof name === "string" ? name : "tool";
    return {
      kind: "tool", name: toolName, failed: result?.isError === true,
      running: Reflect.get(component, "executionStarted") === true && Reflect.get(component, "isPartial") === true,
      file: editStat(toolName, Reflect.get(component, "args"), result, Reflect.get(component, "cwd") ?? process.cwd()),
    };
  }
  if (component instanceof AssistantMessageComponent) {
    const message = Reflect.get(component, "lastMessage");
    const streaming = Reflect.get(component, "isStreaming") === true;
    const stop = message?.stopReason;
    const terminal = !streaming && ["stop", "length", "error", "aborted"].includes(stop);
    const visible = message?.content?.some((block: { type: string; text?: string; thinking?: string }) =>
      (block.type === "text" && block.text?.trim()) || (block.type === "thinking" && block.thinking?.trim()),
    ) || stop === "error" || stop === "aborted" || stop === "length";
    const readable = message?.content?.some((block: { type: string; text?: string }) => block.type === "text" && block.text?.trim())
      || ["error", "aborted", "length"].includes(stop);
    return {
      kind: "assistant", terminal, visible: !!visible, readable: !!readable, streaming,
      startedAt: message?.timestamp,
      usage: !streaming && message?.usage?.input + message?.usage?.cacheRead + message?.usage?.cacheWrite > 0 ? message.usage : undefined,
    };
  }
  return { kind: "other" };
}

export function summaryText(summary: Summary, theme?: Theme): string {
  const fg = (color: Parameters<Theme["fg"]>[0], text: string) => theme ? theme.fg(color, text) : text;
  const diff = (added: number, removed: number) => {
    if (!theme) return formatDiff(added, removed);
    return [
      added || !removed ? fg("toolDiffAdded", `+${added}`) : "",
      removed ? fg("toolDiffRemoved", `−${removed}`) : "",
    ].filter(Boolean).join(" ");
  };
  let label = summary.working ? "Working" : "Worked";
  if (summary.durationMs !== undefined) label += ` for ${formatDuration(summary.durationMs)}`;
  const items = [fg("muted", label), fg("muted", `${summary.tools} tool${summary.tools === 1 ? "" : "s"}`), fg("muted", `${summary.messages} msg${summary.messages === 1 ? "" : "s"}`)];
  if (summary.tokens !== undefined) items.push(fg("muted", `${formatTokens(summary.tokens)} tokens`));
  if (summary.files.length) {
    const added = summary.files.reduce((total, file) => total + file.added, 0);
    const removed = summary.files.reduce((total, file) => total + file.removed, 0);
    items.push(`${fg("muted", `${summary.files.length} file${summary.files.length === 1 ? "" : "s"}`)} ${diff(added, removed)}`);
  }
  if (summary.failures) items.push(fg("warning", `${summary.failures} failed`));
  const files = summary.files.map((file) => `  ${fg("toolDiffContext", displayPath(file.path))} ${diff(file.added, file.removed)}`);
  return [`${fg("muted", "▶ ")}${items.join(fg("muted", " · "))}`, ...files].join("\n");
}

function messageKey(message: { role: string; timestamp?: number; toolCallId?: string; content?: unknown }): string {
  if (message.role === "toolResult") return `tool:${message.toolCallId}`;
  const ids = Array.isArray(message.content) ? message.content.filter((block) => block.type === "toolCall").map((block) => block.id).join(",") : "";
  return `${message.role}:${message.timestamp}:${ids}`;
}

export function findTranscript(tui: TUI): Container | undefined {
  const document = tui.children[0];
  if (!(document instanceof Container) || document.children.length !== 3) return undefined;
  const transcript = document.children[2];
  return transcript instanceof Container && transcript.constructor === Container ? transcript : undefined;
}

/** Check Pi's private transcript contract at startup instead of guessing from its version. */
export function findCompatibleTranscript(tui: TUI, theme: Theme): Container | undefined {
  const transcript = findTranscript(tui);
  if (!transcript) return undefined;
  try {
    const assistantFields = ["lastMessage", "isStreaming", "markdownTheme", "outputPad", "markdownTransformers"];
    const toolFields = ["toolName", "toolCallId", "args", "cwd", "executionStarted", "isPartial", "result"];
    const fieldsPresent = (component: Component, fields: string[]) => fields.every((field) => Reflect.has(component, field));
    for (const component of transcript.children) {
      if (component instanceof AssistantMessageComponent && !fieldsPresent(component, assistantFields)) return undefined;
      if (component instanceof ToolExecutionComponent && !fieldsPresent(component, toolFields)) return undefined;
    }

    const message = {
      role: "assistant", content: [{ type: "text", text: "Fold probe response" }], timestamp: 1,
      stopReason: "stop", api: "openai-responses", provider: "probe", model: "probe",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } as ConstructorParameters<typeof AssistantMessageComponent>[0];
    const assistant = new AssistantMessageComponent(message);
    const tool = new ToolExecutionComponent("probe", "probe-call", {}, {}, undefined, tui, process.cwd());
    if (!fieldsPresent(assistant, assistantFields) || !fieldsPresent(tool, toolFields)) return undefined;
    const assistantRow = describe(assistant);
    if (assistantRow.kind !== "assistant" || assistantRow.terminal !== true) return undefined;
    tool.updateResult({ content: [{ type: "text", text: "Fold probe output" }], isError: true });
    const toolRow = describe(tool);
    if (toolRow.kind !== "tool" || toolRow.name !== "probe" || !toolRow.failed) return undefined;

    const sample = new Container();
    sample.addChild(tool);
    sample.addChild(assistant);
    const native = sample.render(80);
    const detach = attachTranscript(sample, () => ({ mode: "folded", active: false, theme }));
    try {
      const folded = sample.render(80).join("\n");
      if (!folded.includes("Fold probe response") || folded.includes("Fold probe output")) return undefined;
    } finally { detach(); }
    if (JSON.stringify(sample.render(80)) !== JSON.stringify(native)) return undefined;
    return transcript;
  } catch {
    return undefined;
  }
}

/** Patch only the mounted transcript, never tool prototypes, pickers, or model context. */
export function attachTranscript(
  container: Container,
  getState: () => { mode: Mode; active: boolean; theme: Theme; entries?: readonly SessionEntry[]; now?: number },
): () => void {
  const original = container.render;
  const own = Object.getOwnPropertyDescriptor(container, "render");
  const settledViews = new WeakMap<AssistantMessageComponent, { message: unknown; theme: Theme; view: AssistantMessageComponent }>();
  const render = function (width: number): string[] {
    const state = getState();
    if (state.mode !== "folded") return original.call(container, width);
    const rows = container.children.map(describe);
    const completions = new Map<string, number>();
    for (const entry of state.entries ?? []) {
      if (entry.type !== "message") continue;
      const endedAt = Date.parse(entry.timestamp);
      if (Number.isFinite(endedAt)) completions.set(messageKey(entry.message), endedAt);
    }
    container.children.forEach((component, index) => {
      if (component instanceof AssistantMessageComponent) {
        const message = Reflect.get(component, "lastMessage");
        if (message) rows[index].endedAt = completions.get(messageKey(message));
      } else if (component instanceof ToolExecutionComponent) {
        rows[index].endedAt = completions.get(`tool:${Reflect.get(component, "toolCallId")}`);
      }
    });
    const projection = project(rows, state.mode, state.active, state.now);
    // A separate view keeps even hidden components mounted in the real container.
    // Pi can keep updating pending tools and expand them using its native APIs.
    const view = new Container();
    container.children.forEach((component, index) => {
      const summary = projection.summaries.get(index);
      if (summary) {
        const text = summaryText(summary, state.theme).split("\n").map((line) => truncateToWidth(line, Math.max(1, width))).join("\n");
        view.addChild(new Text(`\n${text}`, 0, 0));
      }
      if (projection.hidden.has(index)) return;
      if (component instanceof AssistantMessageComponent && index !== projection.currentAssistant) {
        // Hide settled reasoning without changing the original message or Ctrl+T
        // state. Expanding the transcript still exposes the unmodified component.
        const message = Reflect.get(component, "lastMessage");
        if (!message) return;
        let cached = settledViews.get(component);
        if (!cached || cached.message !== message || cached.theme !== state.theme) {
          const textOnly = { ...message, content: message.content.filter((block: { type: string }) => block.type !== "thinking") };
          const textView = new AssistantMessageComponent(textOnly, true, Reflect.get(component, "markdownTheme"), "Thinking...", Reflect.get(component, "outputPad"), Reflect.get(component, "markdownTransformers"));
          cached = { message, theme: state.theme, view: textView };
          settledViews.set(component, cached);
        }
        view.addChild(cached.view);
      } else view.addChild(component);
    });
    if (projection.thinking) view.addChild(new Text(`\n${state.theme.fg("thinkingText", "Thinking...")}`, 1, 0));
    const lines = original.call(view, width);
    // Preserve native mouse hit-testing against visible rows, not hidden ones.
    Reflect.set(container, "mouseLayout", Reflect.get(view, "mouseLayout"));
    return lines;
  };
  container.render = render;
  return () => {
    if (container.render !== render) return;
    if (own) Object.defineProperty(container, "render", own);
    else Reflect.deleteProperty(container, "render");
  };
}
