import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Container } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import toolFold from "../index.ts";

test("editor shortcuts expand in place, preserve drafts, remember selection, and detach on reload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-tool-fold-ui-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  type Factory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
  const handlers = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, any>();
  const pi = {
    on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
    registerCommand: (name: string, command: any) => commands.set(name, command),
  } as unknown as ExtensionAPI;
  const chat = new Container();
  const document = new Container();
  document.children = [new Container(), new Container(), chat];
  let clearOnShrink = false;
  const tui = {
    children: [document], requestRender() {},
    getClearOnShrink: () => clearOnShrink,
    setClearOnShrink: (value: boolean) => { clearOnShrink = value; },
  };
  let draft = "Do not lose this draft";
  const passedThrough: string[] = [];
  const baseFactory = (() => ({
    handleInput: (data: string) => passedThrough.push(data),
    getText: () => draft, setText: (text: string) => { draft = text; },
  })) as unknown as Factory;
  let factory: Factory | undefined = baseFactory;
  let editor: ReturnType<Factory>;
  let expanded = false;
  let status: string | undefined;
  const ctx = {
    mode: "tui", isIdle: () => true,
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      getEditorComponent: () => factory,
      setEditorComponent: (value: Factory | undefined) => {
        factory = value;
        editor = (value ?? baseFactory)(tui as any, {} as any, {} as any);
      },
      getToolsExpanded: () => expanded,
      setToolsExpanded: (value: boolean) => { expanded = value; },
      setStatus: (_key: string, value: string | undefined) => { status = value; },
      notify() {},
    },
  } as unknown as ExtensionContext;
  const emit = (name: string) => handlers.get(name)?.({}, ctx);
  try {
    toolFold(pi);
    await emit("session_start");
    assert.equal(status, "tools: folded");
    assert.equal(clearOnShrink, true);
    editor!.handleInput!("\x0f");
    assert.equal(status, "tools: regular");
    assert.equal(expanded, false);
    editor!.handleInput!("\x0f");
    assert.equal(status, "tools: expanded");
    assert.equal(expanded, true);
    editor!.handleInput!("\x0f");
    assert.equal(status, "tools: expanded");
    assert.equal(editor!.getText(), draft);
    assert.deepEqual(passedThrough, [], "Ctrl+O must not also toggle the native handler");
    editor!.handleInput!("\x1b[111;6u");
    assert.equal(status, "tools: regular");
    editor!.handleInput!("\x1b[111;6u");
    assert.equal(status, "tools: folded");
    editor!.handleInput!("\x1b[111;6u");
    assert.equal(status, "tools: folded");
    editor!.handleInput!("ordinary input");
    assert.deepEqual(passedThrough, ["ordinary input"]);

    await commands.get("tool-fold").handler("expanded", ctx);
    const settings = join(directory, "pi-tool-fold.json");
    assert.equal(JSON.parse(readFileSync(settings, "utf8")).mode, "expanded");
    await emit("session_shutdown");
    assert.equal(factory, baseFactory);
    assert.equal(clearOnShrink, false);
    assert.equal(Object.hasOwn(chat, "render"), false);
    assert.equal(status, undefined);
    assert.equal(expanded, false);
    assert.equal(JSON.parse(readFileSync(settings, "utf8")).mode, "expanded", "shutdown must not overwrite the selection");

    toolFold(pi);
    await emit("session_start");
    assert.equal(status, "tools: expanded");
    assert.equal(expanded, true);
    await emit("session_shutdown");
    assert.equal(factory, baseFactory);
  } finally {
    await emit("session_shutdown");
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("print and RPC modes do not install TUI rendering or keyboard hooks", () => {
  for (const mode of ["print", "json", "rpc"]) {
    const handlers = new Map<string, (...args: any[]) => any>();
    toolFold({ on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler), registerCommand() {} } as unknown as ExtensionAPI);
    assert.doesNotThrow(() => handlers.get("session_start")!({}, { mode }));
  }
});
