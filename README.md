# pi-tool-fold

Three inline conversation views for Pi. No popovers, no separate history explorer.

```text
Folded  ── Ctrl+O ──▶  Regular  ── Ctrl+O ──▶  Expanded
        ◀─ Ctrl+Shift+O ─────── ◀─ Ctrl+Shift+O ───────
```

Shortcuts stop at either end; they never wrap around. Your draft stays untouched.

| View | Behavior |
| --- | --- |
| **Folded** | While working, keep the newest three tool calls and latest response visible. Older calls become an inline summary. When work finishes, keep the summary and final response. |
| **Regular** | Stock Pi tool calls with their normal output previews. |
| **Expanded** | Stock Pi's fully expanded tool output. |

Example folded summary:

```text
▸ 8 tool calls · read ×5, bash ×2, edit ×1 · Ctrl+O to unfold

The final response appears here.
```

Failed calls are counted in the summary. Interrupted runs keep their last readable partial response or native error message. User prompts, custom notices, and compaction rows remain visible.

## Install

**Requires Pi 0.85.1 for folded mode.** Other versions fall back to regular/expanded views with a warning rather than patch an untested layout.

```bash
pi install git:github.com/csaroff/pi-tool-fold
```

Disable or remove `@onurpi/turn-fold` first. The extensions must not run together. **Restart Pi when migrating from Turn Fold** so its sparse transcript is rebuilt with the native components. Normal updates to this extension work with `/reload`.

For local development:

```bash
pi install ~/code/personal/pi-tool-fold
```

## Controls

- **Ctrl+O**: one step more expanded.
- **Ctrl+Shift+O**: one step more folded.
- `/tool-fold folded|regular|expanded`: select a view directly.
- `/tool-fold status`: show current view and controls.

The shortcuts apply only in the conversation editor. Pi's tree picker, dialogs, and other focused UI retain their own keyboard behavior. Ctrl+T continues to control thinking visibility independently.

Some terminals cannot distinguish Ctrl+Shift+O from Ctrl+O without extended keyboard support. Use the commands if needed; in tmux, enable extended keys with `set -g extended-keys on`.

## Remembered view

First launch starts folded. Explicit view changes are saved to `~/.pi/agent/pi-tool-fold.json` (or under `PI_CODING_AGENT_DIR`). New sessions/processes reuse that choice. Startup and shutdown never write the preference, so an older open session cannot overwrite a newer selection just by exiting. Already-open sessions keep their current view until you change it.

## Safety and limitations

- This is presentation only. No session messages are removed, rewritten, or added, and model context is untouched.
- Both native views render the original components. Hidden tools continue receiving updates and reappear immediately when unfolded, including mid-response.
- Pi's compaction behavior is unchanged. Expanding restores the native transcript that Pi loaded, not history already omitted by compaction.
- Both regular and fullscreen terminal modes are supported. Shrinking the transcript can briefly redraw the screen.
- Folded history groups activity at user prompts, terminal responses, and compaction/branch boundaries. This first version does not show elapsed time or edit diffstats.
- This is not a transcript virtualization layer. It retains all native components, prioritizing reversible views over lower memory use in very long sessions.

Pi has no public whole-transcript folding API. A small version-checked adapter in `src/adapter.ts` patches **one mounted transcript container's render method**, reads native component metadata, and preserves mouse hit-testing. It does not patch global prototypes, tools, session/context builders, or picker renderers. Teardown restores the container, editor hook, and clear-on-shrink setting.

The editor wrapper composes with an already-installed custom editor. An extension that subsequently replaces the editor without composing can take over these shortcuts.

## Development

```bash
npm ci
npm run check
npm pack --dry-run
```

Tests cover reversible folding, streaming visibility, failures, interrupted runs, native renderer parity, keyboard endpoints, drafts, persistence, teardown, and unsupported versions.

For an offline terminal fixture (no provider requests):

```bash
sandbox=$(mktemp -d)
session=$(npx tsx test/create-session.ts "$sandbox")
PI_CODING_AGENT_DIR="$sandbox" pi --offline --no-extensions \
  --no-skills --no-prompt-templates --no-themes --no-context-files \
  -e ./index.ts --session "$session"
```

Check both keyboard directions, draft preservation, `/reload`, and `/tree`. Repeat with `--tui-mode fullscreen`. The fixture contains five calls with long output so regular and expanded views visibly differ.

Folded presentation inspired by [Turn Fold](https://github.com/osolmaz/onurpi/tree/main/packages/turn-fold); implementation is independent.
