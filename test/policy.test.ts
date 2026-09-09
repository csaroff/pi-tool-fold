import assert from "node:assert/strict";
import { test } from "node:test";
import { nextMode, project, type Row } from "../src/policy.ts";

const user = { kind: "user" } as const;
const tool = (name = "read", failed = false): Row => ({ kind: "tool", name, failed });
const assistant = (terminal = false, visible = true): Row => ({ kind: "assistant", terminal, visible });

test("inspect a busy run without leaving the conversation, then return to a quiet transcript", () => {
  // Five tools make the first two distracting, but none may be discarded: a reader
  // must be able to inspect their exact original output without replaying the run.
  const rows: Row[] = [user, assistant(), ...Array.from({ length: 5 }, () => tool()), assistant()];
  const before = structuredClone(rows);
  const folded = project(rows, "folded", true);
  assert.deepEqual(folded.hidden, new Set([1, 2, 3]));
  assert.equal(folded.summaries.get(1)?.hiddenTools, 2);
  assert.equal(folded.summaries.get(1)?.tools, 5);

  let mode = nextMode("folded", 1);
  assert.equal(mode, "regular");
  assert.equal(project(rows, mode, true).hidden.size, 0);
  mode = nextMode(mode, 1);
  assert.equal(mode, "expanded");
  assert.equal(nextMode(mode, 1), "expanded", "expanding at the end must not fold everything");
  assert.equal(project(rows, mode, true).summaries.size, 0);
  assert.equal(nextMode(nextMode(mode, -1), -1), "folded");
  assert.deepEqual(rows, before, "view changes must not mutate source history");

  rows.push(assistant(true));
  const settled = project(rows, "folded", false);
  assert.deepEqual(settled.hidden, new Set([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(settled.hidden.has(8), false, "the final response stays visible");
});

test("a new run does not reopen tools from a completed run", () => {
  const rows: Row[] = [user, tool(), assistant(true), user, tool("bash"), assistant()];
  assert.deepEqual(project(rows, "folded", true).hidden, new Set([1]));
});

test("extension-started runs after a final response get their own folding boundary", () => {
  const rows: Row[] = [user, tool(), assistant(true), assistant(), tool("bash")];
  const result = project(rows, "folded", true);
  assert.equal(result.hidden.has(1), true);
  assert.equal(result.hidden.has(2), false);
  assert.equal(result.hidden.has(4), false);
});

test("an interrupted tool run preserves its last partial response and counts failures", () => {
  const rows: Row[] = [user, assistant(false, true), tool("bash", true)];
  const result = project(rows, "folded", false);
  assert.equal(result.hidden.has(1), false);
  assert.equal(result.hidden.has(2), true);
  assert.equal(result.summaries.get(1)?.failures, 1);
});

test("an empty final tool-call message does not replace a readable partial response", () => {
  const rows: Row[] = [user, assistant(false, true), assistant(false, false), tool()];
  assert.deepEqual(project(rows, "folded", false).hidden, new Set([2, 3]));
});

test("user prompts, custom rows and compaction boundaries are never hidden", () => {
  const rows: Row[] = [user, tool(), { kind: "other" }, { kind: "boundary" }, user, assistant(true)];
  assert.deepEqual(project(rows, "folded", false).hidden, new Set([1]));
});

test("folding stops at the folded endpoint", () => {
  assert.equal(nextMode("folded", -1), "folded");
});
