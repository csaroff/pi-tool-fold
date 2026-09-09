import {
  AssistantMessageComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { project, type Mode, type Row, type Summary } from "./policy.ts";

// The document layout and component fields below are private Pi integration points.
// Keep the compatibility check narrow until the adapter tests cover another release.
export function supportedVersion(version: string): boolean {
  return version === "0.85.1";
}

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
    return { kind: "tool", name: typeof name === "string" ? name : "tool", failed: result?.isError === true };
  }
  if (component instanceof AssistantMessageComponent) {
    const message = Reflect.get(component, "lastMessage");
    const streaming = Reflect.get(component, "isStreaming") === true;
    const stop = message?.stopReason;
    const terminal = !streaming && ["stop", "length", "error", "aborted"].includes(stop);
    const visible = message?.content?.some((block: { type: string; text?: string; thinking?: string }) =>
      (block.type === "text" && block.text?.trim()) || (block.type === "thinking" && block.thinking?.trim()),
    ) || stop === "error" || stop === "aborted" || stop === "length";
    return { kind: "assistant", terminal, visible: !!visible };
  }
  return { kind: "other" };
}

export function summaryText(summary: Summary): string {
  const label = summary.working
    ? `${summary.hiddenTools} earlier tool call${summary.hiddenTools === 1 ? "" : "s"}`
    : `${summary.tools} tool call${summary.tools === 1 ? "" : "s"}`;
  const names = [...summary.names].map(([name, count]) => `${name} ×${count}`).join(", ");
  const failures = summary.failures ? ` · ${summary.failures} failed` : "";
  return `▸ ${label} · ${names}${failures} · Ctrl+O to unfold`;
}

export function findTranscript(tui: TUI): Container | undefined {
  const document = tui.children[0];
  if (!(document instanceof Container) || document.children.length !== 3) return undefined;
  const transcript = document.children[2];
  return transcript instanceof Container && transcript.constructor === Container ? transcript : undefined;
}

/** Patch only the mounted transcript, never tool prototypes, pickers, or model context. */
export function attachTranscript(
  container: Container,
  getState: () => { mode: Mode; active: boolean; theme: Theme },
): () => void {
  const original = container.render;
  const own = Object.getOwnPropertyDescriptor(container, "render");
  const render = function (width: number): string[] {
    const state = getState();
    if (state.mode !== "folded") return original.call(container, width);
    const rows = container.children.map(describe);
    const projection = project(rows, state.mode, state.active);
    // A separate view keeps even hidden components mounted in the real container.
    // Pi can keep updating pending tools and expand them using its native APIs.
    const view = new Container();
    container.children.forEach((component, index) => {
      const summary = projection.summaries.get(index);
      if (summary) {
        const text = truncateToWidth(summaryText(summary), Math.max(1, width));
        view.addChild(new Text(`\n${state.theme.fg(summary.failures ? "warning" : "muted", text)}`, 0, 0));
      }
      if (!projection.hidden.has(index)) view.addChild(component);
    });
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
