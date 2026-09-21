import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, initTheme, ToolExecutionComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, type TUI } from "@earendil-works/pi-tui";
import { attachTranscript } from "../src/adapter.ts";

initTheme("dark", false);
const theme = { fg: (_color: string, text: string) => text } as Theme;
const ui = { requestRender() {} } as unknown as TUI;
function assistant(thinking: string, text = "", stopReason = "toolUse") {
  return {
    role: "assistant", timestamp: 1000, stopReason,
    content: [{ type: "thinking", thinking }, { type: "text", text }],
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 },
  } as ConstructorParameters<typeof AssistantMessageComponent>[0];
}

test("interleaved prose remains a readable timeline with work summarized between messages", () => {
  // Some models explain what they learned before making their next tool call.
  // Collapsing implementation detail must not turn those separate updates into
  // one apparent final message or hide context that the final answer relies on.
  const chat = new Container();
  const prose = ["FIRST_UPDATE", "SECOND_UPDATE", "FINAL_ANSWER"];
  chat.addChild(new AssistantMessageComponent(assistant("SECRET_THINKING_1", prose[0])));
  for (let index = 0; index < 2; index++) {
    const tool = new ToolExecutionComponent("read", `interleaved-${index}`, { path: `HIDDEN_TOOL_${index}` }, {}, undefined, ui, process.cwd());
    tool.markExecutionStarted();
    tool.updateResult({ content: [{ type: "text", text: `HIDDEN_RESULT_${index}` }], isError: false });
    chat.addChild(tool);
    chat.addChild(new AssistantMessageComponent(assistant(`SECRET_THINKING_${index + 2}`, prose[index + 1], index === 1 ? "stop" : "toolUse")));
  }

  const detach = attachTranscript(chat, () => ({ mode: "folded", active: false, theme }));
  try {
    const output = chat.render(100).join("\n");
    const summaries = [...output.matchAll(/▶ Worked/g)].map((match) => match.index!);
    assert.equal(summaries.length, 2, "each hidden tool block gets its own summary");
    assert.ok(output.indexOf(prose[0]) < summaries[0]);
    assert.ok(summaries[0] < output.indexOf(prose[1]));
    assert.ok(output.indexOf(prose[1]) < summaries[1]);
    assert.ok(summaries[1] < output.indexOf(prose[2]));
    assert.doesNotMatch(output, /HIDDEN_TOOL_|HIDDEN_RESULT_|SECRET_THINKING_/);
  } finally { detach(); }
});

test("a collapsed run shows current thinking, not three completed tools or stale thinking", () => {
  // A quiet view must still prove the model is alive. In particular, starting the
  // next response with no tokens yet must replace stale tool output with Thinking.
  const chat = new Container();
  const prior = new AssistantMessageComponent(assistant("OLD_THINKING", "I will check."));
  chat.addChild(prior);
  const tools = Array.from({ length: 3 }, (_, index) => {
    const tool = new ToolExecutionComponent("read", `t${index}`, { path: `OLD_TOOL_${index}` }, {}, undefined, ui, process.cwd());
    tool.markExecutionStarted();
    tool.updateResult({ content: [{ type: "text", text: "DONE" }], isError: false });
    chat.addChild(tool);
    return tool;
  });
  const current = new AssistantMessageComponent(undefined, true);
  current.updateContent(assistant("", "")!, true);
  chat.addChild(current);
  let active = true;
  const detach = attachTranscript(chat, () => ({ mode: "folded", active, theme }));
  try {
    let output = chat.render(100).join("\n");
    assert.match(output, /Thinking/);
    assert.doesNotMatch(output, /OLD_TOOL_|OLD_THINKING/);
    current.updateContent(assistant("LIVE_THINKING")!, true);
    output = chat.render(100).join("\n");
    assert.match(output, /Thinking/);
    assert.doesNotMatch(output, /LIVE_THINKING/, "respect native hidden-thinking preference");
    current.setHideThinkingBlock(false);
    output = chat.render(100).join("\n");
    assert.match(output, /LIVE_THINKING/);
    assert.doesNotMatch(output, /OLD_TOOL_|OLD_THINKING/);

    current.updateContent(assistant("LIVE_THINKING", "", "toolUse")!, false);
    const running = new ToolExecutionComponent("bash", "running", { command: "CURRENT_TOOL" }, {}, undefined, ui, process.cwd());
    running.markExecutionStarted();
    chat.addChild(running);
    output = chat.render(100).join("\n");
    assert.match(output, /CURRENT_TOOL/);
    assert.doesNotMatch(output, /LIVE_THINKING|OLD_TOOL_|OLD_THINKING/);
    running.updateResult({ content: [], isError: false });
    const final = new AssistantMessageComponent(assistant("FINAL_THINKING", "FINAL_ANSWER", "stop"));
    chat.addChild(final);
    active = false;
    output = chat.render(100).join("\n");
    assert.match(output, /FINAL_ANSWER/);
    assert.doesNotMatch(output, /CURRENT_TOOL|THINKING|OLD_TOOL_/);
    assert.equal(chat.children.includes(tools[0]), true);
  } finally { detach(); }
  assert.match(chat.render(100).join("\n"), /FINAL_THINKING/);
});
