import { join } from "node:path";
import { CustomEditor, getAgentDir, VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import { attachTranscript, findTranscript, supportedVersion } from "./src/adapter.ts";
import { isMode, nextMode, type Mode } from "./src/policy.ts";
import { loadMode, saveMode } from "./src/settings.ts";

export default function toolFold(pi: ExtensionAPI) {
  const settingsPath = join(getAgentDir(), "pi-tool-fold.json");
  let mode = loadMode(settingsPath);
  let context: ExtensionContext | undefined;
  let tui: TUI | undefined;
  let restore: (() => void) | undefined;
  let available = false;
  let live = false;

  function refresh() {
    if (!context || !live) return;
    context.ui.setToolsExpanded(mode === "expanded");
    context.ui.setStatus("pi-tool-fold", `tools: ${mode}`);
    tui?.requestRender();
  }

  function select(requested: Mode) {
    if (!context || !live) return;
    if (requested === "folded" && !available) {
      context.ui.notify("Inline folding is unavailable on this Pi layout/version. Regular and expanded views still work.", "warning");
      return;
    }
    if (mode === requested) return;
    mode = requested;
    try {
      saveMode(settingsPath, mode);
    } catch (error) {
      context.ui.notify(`View changed, but could not save preference: ${String(error)}`, "warning");
    }
    refresh();
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    restore?.();
    context = ctx;
    live = true;
    const previous = ctx.ui.getEditorComponent();
    const factory: NonNullable<ReturnType<typeof ctx.ui.getEditorComponent>> = (ui, theme, keys) => {
      tui = ui;
      const editor = previous?.(ui, theme, keys) ?? new CustomEditor(ui, theme, keys, { embedWorkingStatus: true });
      const transcript = supportedVersion(VERSION) ? findTranscript(ui) : undefined;
      available = !!transcript;
      const originalClear = ui.getClearOnShrink();
      const originalExpanded = ctx.ui.getToolsExpanded();
      if (mode === "folded" && !available) mode = "regular";
      const detach = transcript ? attachTranscript(transcript, () => ({
        mode, active: !ctx.isIdle(), theme: ctx.ui.theme,
      })) : undefined;
      if (transcript) ui.setClearOnShrink(true);
      const handleInput = editor.handleInput;
      const input = (data: string) => {
        // Intercept only in the editor: tree filters and dialogs keep their keys.
        if (live && matchesKey(data, "ctrl+shift+o")) { select(nextMode(mode, -1)); return; }
        if (live && matchesKey(data, "ctrl+o")) { select(nextMode(mode, 1)); return; }
        handleInput.call(editor, data);
      };
      editor.handleInput = input;
      restore = () => {
        live = false;
        detach?.();
        if (editor.handleInput === input) editor.handleInput = handleInput;
        ui.setClearOnShrink(originalClear);
        ctx.ui.setToolsExpanded(originalExpanded);
        ctx.ui.setStatus("pi-tool-fold", undefined);
        if (ctx.ui.getEditorComponent() === factory) ctx.ui.setEditorComponent(previous);
      };
      return editor;
    };
    ctx.ui.setEditorComponent(factory);
    if (!available) ctx.ui.notify(`pi-tool-fold: folding adapter requires Pi 0.85.1's transcript layout (running ${VERSION}). Using native views.`, "warning");
    refresh();
  });

  // The normal renderer owns streaming updates. Settlement also needs a frame
  // when the final event is an interruption rather than a new assistant message.
  pi.on("agent_end", () => { tui?.requestRender(); });
  pi.on("session_shutdown", () => { restore?.(); restore = undefined; });

  pi.registerCommand("tool-fold", {
    description: "Inline tool view: folded | regular | expanded | status",
    getArgumentCompletions: (prefix) => ["folded", "regular", "expanded", "status"]
      .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") return;
      const value = args.trim();
      if (!value || value === "status") {
        ctx.ui.notify(`Tools: ${mode}. Ctrl+O expands; Ctrl+Shift+O folds. /tool-fold folded|regular|expanded`, "info");
      } else if (isMode(value)) select(value);
      else ctx.ui.notify("Usage: /tool-fold folded|regular|expanded|status", "warning");
    },
  });
}
