import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { editStat, contextDelta, duration, formatDuration, mergeFiles } from "../src/stats.ts";
import { summaryText } from "../src/adapter.ts";

const patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,3 @@\n-old\n+new\n+extra\n context\n";
test("a completed run reports work, context growth and cumulative edits without double-counting billed input", () => {
  // Cached input is still in context. Repeated prompts must not inflate the delta,
  // and repeated edits to one file must not count as additional files.
  const stats = [
    { startedAt: 1000, endedAt: 2000, usage: { input: 200, cacheRead: 800, cacheWrite: 0, output: 100 } },
    { file: editStat("edit", { path: "test/example.ts" }, { details: { patch } }, homedir()) },
    { file: editStat("edit", { path: "test/example.ts" }, { details: { patch } }, homedir()) },
    { startedAt: 5000, endedAt: 721000, usage: { input: 1000, cacheRead: 4500, cacheWrite: 0, output: 500 } },
  ];
  const text = summaryText({ working: false, tools: 32, messages: 31, failures: 0,
    files: mergeFiles(stats), tokens: contextDelta(stats), durationMs: duration(stats, false, 999999) });
  assert.equal(text, "▶ Worked for 12m · 32 tools · 31 msgs · +5k tokens · 1 file +4 −2\n  ~/test/example.ts +4 −2");
});

test("failed edits and bash results cannot claim successful file changes", () => {
  assert.equal(editStat("edit", { path: "file" }, { isError: true, details: { patch } }, "/tmp"), undefined);
  assert.equal(editStat("bash", { path: "file" }, { details: { patch } }, "/tmp"), undefined);
  assert.equal(editStat("write", { path: "file" }, { content: [] }, "/tmp"), undefined);
  assert.equal(editStat("edit", { path: "file" }, { content: [] }, "/tmp"), undefined);
});

test("patch headers, context, and no-newline markers are not changed lines", () => {
  const file = editStat("edit", { path: "/tmp/a" }, { details: { patch: `${patch}\\ No newline at end of file\n@@ -8 +9 @@\n---literal\n+++literal\n` } }, "/ignored");
  assert.deepEqual(file, { path: "/tmp/a", added: 3, removed: 2 });
  assert.deepEqual(editStat("edit", { path: "~/a" }, { details: { diff: " 1 unchanged\n-2 old\n+2 new\n+3 extra" } }, "/tmp"), { path: `${homedir()}/a`, added: 2, removed: 1 });
});

test("unknown usage and historical timing are omitted, not presented as invented zeroes", () => {
  assert.equal(contextDelta([]), undefined);
  assert.equal(contextDelta([{ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]), undefined);
  assert.equal(duration([{ startedAt: 1000 }], false, 2000), undefined);
  assert.equal(duration([{ startedAt: 1000 }], true, 2000), 1000);
  assert.equal(formatDuration(999), "<1s");
  assert.equal(formatDuration(61000), "1m 1s");
  assert.equal(formatDuration(3660000), "1h 1m");
});

test("context shrinkage is signed and file deletions do not invent additions", () => {
  assert.equal(contextDelta([
    { usage: { input: 10000, cacheRead: 0, cacheWrite: 0, output: 100 } },
    { usage: { input: 1000, cacheRead: 0, cacheWrite: 0, output: 100 } },
  ]), -8900);
  const text = summaryText({ working: true, tools: 1, messages: 2, failures: 1, tokens: -8900,
    files: [{ path: "/tmp/deleted", added: 0, removed: 4 }] });
  assert.match(text, /−8.9k tokens/);
  assert.match(text, /1 file −4/);
  assert.match(text, /1 failed/);
});
