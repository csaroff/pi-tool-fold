import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, initTheme, ToolExecutionComponent, UserMessageComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { attachTranscript, describe, findTranscript, supportedVersion } from "../src/adapter.ts";
import type { Mode } from "../src/policy.ts";
import { withBuiltInRenderers } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/renderers/index.js";

initTheme("dark", false);
const theme = { fg: (_color: string, text: string) => text } as Theme;
const ui = { requestRender() {}, terminal: { columns: 100, rows: 30 } } as unknown as TUI;
const message = (text: string, stopReason = "toolUse") => ({
  role: "assistant", content: [{ type: "text", text }], timestamp: 1000,
  stopReason, api: "openai-responses", provider: "openai", model: "test",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
}) as ConstructorParameters<typeof AssistantMessageComponent>[0];

function fixture() {
  const chat = new Container();
  chat.addChild(new UserMessageComponent("Inspect five files"));
  chat.addChild(new AssistantMessageComponent(message("Checking the files.")));
  const tools = Array.from({ length: 5 }, (_, index) => {
    const component = new ToolExecutionComponent("bash", `call-${index}`, { command: `echo TOOL_${index}` }, {}, withBuiltInRenderers("bash", undefined), ui, process.cwd());
    component.updateResult({ content: [{ type: "text", text: Array.from({ length: 30 }, (_, line) => `RESULT_${index}_${line}`).join("\n") }], isError: false });
    chat.addChild(component);
    return component;
  });
  return { chat, tools };
}

test("native transcript components survive folding, streaming updates, expansion and teardown", () => {
  // Compare to Pi's own render output, not an imitation: tool formatting, padding,
  // truncation, and expanded output must all remain exactly as stock Pi renders them.
  const { chat, tools } = fixture();
  const originalChildren = chat.children;
  const nativeRegular = chat.render(100);
  tools.forEach((tool) => tool.setExpanded(true));
  const nativeExpanded = chat.render(100);
  assert.notDeepEqual(nativeRegular, nativeExpanded);
  tools.forEach((tool) => tool.setExpanded(false));
  let mode: Mode = "folded";
  let active = true;
  const detach = attachTranscript(chat, () => ({ mode, active, theme }));
  try {
    const folded = chat.render(100).join("\n");
    assert.match(folded, /2 earlier tool calls/);
    assert.doesNotMatch(folded, /TOOL_0|TOOL_1/);
    assert.match(folded, /TOOL_2/);
    assert.match(folded, /TOOL_4/);
    assert.equal(chat.children, originalChildren);
    mode = "regular";
    assert.deepEqual(chat.render(100), nativeRegular);
    mode = "expanded";
    tools.forEach((tool) => tool.setExpanded(true));
    assert.deepEqual(chat.render(100), nativeExpanded);

    mode = "folded";
    tools.forEach((tool) => tool.setExpanded(false));
    tools[0].updateResult({ content: [{ type: "text", text: "A hidden result updated" }], isError: true });
    const final = new AssistantMessageComponent(message("All files checked.", "stop"));
    chat.addChild(final);
    active = false;
    const settled = chat.render(100).join("\n");
    assert.match(settled, /5 tool calls/);
    assert.match(settled, /1 failed/);
    assert.match(settled, /All files checked/);
    assert.doesNotMatch(settled, /TOOL_|Checking the files/);
    mode = "regular";
    assert.match(chat.render(100).join("\n"), /A hidden result updated/);
    mode = "folded";
  } finally { detach(); }
  assert.equal(Object.hasOwn(chat, "render"), false);
  assert.match(chat.render(100).join("\n"), /TOOL_4/);
});

test("only the mounted transcript folds; unrelated containers keep stock rendering", () => {
  const { chat } = fixture();
  const document = new Container();
  document.addChild(new Container());
  document.addChild(new Container());
  document.addChild(chat);
  assert.equal(findTranscript({ children: [document] } as unknown as TUI), chat);
  assert.equal(findTranscript({ children: [] } as unknown as TUI), undefined);
  const unrelated = fixture().chat;
  const native = unrelated.render(80);
  const detach = attachTranscript(chat, () => ({ mode: "folded", active: false, theme }));
  assert.deepEqual(unrelated.render(80), native);
  detach();
});

test("a streaming final response stays open until it actually settles", () => {
  const component = new AssistantMessageComponent(message("Answer", "stop"));
  component.updateContent(message("Answer", "stop")!, true);
  assert.deepEqual(describe(component), { kind: "assistant", terminal: false, visible: true });
  component.updateContent(message("Answer", "stop")!, false);
  assert.deepEqual(describe(component), { kind: "assistant", terminal: true, visible: true });
});

test("narrow terminals, custom notices, and repeated attach/detach remain safe", () => {
  const { chat } = fixture();
  chat.addChild(new Text("Custom notice", 0, 0));
  for (let cycle = 0; cycle < 3; cycle++) {
    const detach = attachTranscript(chat, () => ({ mode: "folded", active: false, theme }));
    for (const width of [1, 10, 40, 100]) assert.doesNotThrow(() => chat.render(width));
    assert.match(chat.render(100).join("\n"), /Custom notice/);
    detach();
    detach();
  }
});

test("an untested Pi version cannot silently patch a changed private layout", () => {
  assert.equal(supportedVersion("0.85.1"), true);
  for (const version of ["0.84.3", "0.85.2", "0.86.0", "0.85.1-beta.1"]) {
    assert.equal(supportedVersion(version), false);
  }
});
