import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadMode, saveMode } from "../src/settings.ts";

test("a selected view survives a restart without saving routine startup or shutdown state", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-tool-fold-"));
  const path = join(directory, "settings.json");
  try {
    assert.equal(loadMode(path), "folded");
    saveMode(path, "expanded");
    assert.equal(loadMode(path), "expanded");
    const contents = readFileSync(path, "utf8");
    loadMode(path);
    assert.equal(readFileSync(path, "utf8"), contents);
    saveMode(path, "regular");
    assert.equal(loadMode(path), "regular");
    for (const invalid of ["{", "null", '{"mode":"wrong"}', "[]"]) {
      writeFileSync(path, invalid);
      assert.equal(loadMode(path), "folded");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
