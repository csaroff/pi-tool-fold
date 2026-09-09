# pi-tool-fold

Three inline conversation views for Pi. No popovers, no separate history explorer.

```text
Collapsed ── Ctrl+O ──▶ Regular ── Ctrl+O ──▶ Expanded
          ◀─ Ctrl+Shift+O ───── ◀─ Ctrl+Shift+O ──────
```

Shortcuts stop at either end; they never wrap around. Your draft stays untouched.

| View | Behavior |
| --- | --- |
| **Collapsed** | Show only current activity: the running tool, live response, or thinking. Completed activity becomes a work summary; the final response stays visible without its thinking trace. |
| **Regular** | Stock Pi tool calls with their normal output previews. |
| **Expanded** | Stock Pi's fully expanded tool output. |

Example collapsed summary:

```text
▶ Worked for 12m · 32 tools · 31 msgs · +5k tokens · 2 files +5 −4
  ~/project/src/index.ts +3 −3
  ~/project/README.md +2 −1

The final response appears here.
```

While working, the summary says **Working for…** and updates every second. Thinking stays visible: Pi's **Thinking…** label when traces are hidden, or the full live trace when enabled. Before any tokens arrive, a **Thinking…** placeholder keeps the view from looking stuck. Completed tool calls and old thinking disappear immediately; unfolding restores them.

Failed calls are counted in the summary. Interrupted runs keep their last readable partial response or native error message. User prompts, custom notices, and compaction rows remain visible.

## Install

**Requires Pi 0.85.1 for collapsed mode.** Other versions fall back to regular/expanded views with a warning rather than patch an untested layout.

```bash
pi install git:github.com/csaroff/pi-tool-fold
```

For local development:

```bash
pi install ~/code/personal/pi-tool-fold
```

## Controls

- **Ctrl+O**: one step more expanded.
- **Ctrl+Shift+O**: one step more folded.
- `/tool-fold collapsed|regular|expanded`: select a view directly (`folded` remains an alias).
- `/tool-fold status`: show current view and controls.

The shortcuts apply only in the conversation editor. Pi's tree picker, dialogs, and other focused UI retain their own keyboard behavior. Ctrl+T continues to control thinking visibility independently.

Some terminals cannot distinguish Ctrl+Shift+O from Ctrl+O without extended keyboard support. Use the commands if needed; in tmux, enable extended keys with `set -g extended-keys on`.

## Remembered view

First launch starts collapsed. Explicit view changes are saved to `~/.pi/agent/pi-tool-fold.json` (or under `PI_CODING_AGENT_DIR`). New sessions/processes reuse that choice. Startup and shutdown never write the preference, so an older open session cannot overwrite a newer selection just by exiting. Already-open sessions keep their current view until you change it.

## Safety and limitations

- This is presentation only. No session messages are removed, rewritten, or added, and model context is untouched.
- Both native views render the original components. Hidden tools continue receiving updates and reappear immediately when unfolded, including mid-response.
- Pi's compaction behavior is unchanged. Expanding restores the native transcript that Pi loaded, not history already omitted by compaction.
- Both regular and fullscreen terminal modes are supported. Shrinking the transcript can briefly redraw the screen.
- Collapsed history groups activity at user prompts, terminal responses, and compaction/branch boundaries. With parallel tools, only the newest still-running tool is shown.
- This is not a transcript virtualization layer. It retains all native components, prioritizing reversible views over lower memory use in very long sessions.

### Summary numbers

- **Duration:** from the first response's request timestamp to the last recorded completion (or now while running). Historical completion times come from session entries. Unknown timing is omitted.
- **Tools / msgs:** tool calls and assistant messages, respectively, including the final response. Tool results and user prompts are not counted as assistant messages.
- **Tokens:** estimated context growth from the first request's input to the latest completed response's input + output, including cached tokens. This is **not** total billed tokens or a sum of repeated inputs. It excludes the initial prompt, appears only once usage is available, and restarts at compaction boundaries.
- **Files:** successful `edit` results, grouped by normalized path. Additions/deletions accumulate across edits; they are not the final net git diff. Failed edits are excluded. Bash and `write` changes are not tracked yet.

Pi has no public whole-transcript folding API. A small version-checked adapter in `src/adapter.ts` patches **one mounted transcript container's render method**, reads native component metadata, and preserves mouse hit-testing. It does not patch global prototypes, tools, session/context builders, or picker renderers. Teardown restores the container, editor hook, and clear-on-shrink setting.

The editor wrapper composes with an already-installed custom editor. An extension that subsequently replaces the editor without composing can take over these shortcuts.

## Development

```bash
npm ci
npm run check
npm pack --dry-run
```

Tests cover reversible folding, current activity and thinking visibility, work summaries, context growth, edit diffstats, failures, interrupted runs, native renderer parity, keyboard endpoints, drafts, persistence, teardown, and unsupported versions.

For an offline terminal fixture (no provider requests):

```bash
sandbox=$(mktemp -d)
session=$(npx tsx test/create-session.ts "$sandbox")
PI_CODING_AGENT_DIR="$sandbox" pi --offline --no-extensions \
  --no-skills --no-prompt-templates --no-themes --no-context-files \
  -e ./index.ts --session "$session"
```

Check both keyboard directions, draft preservation, `/reload`, and `/tree`. Repeat with `--tui-mode fullscreen`. The fixture contains five calls with long output so regular and expanded views visibly differ.

Collapsed presentation inspired by [Turn Fold](https://github.com/osolmaz/onurpi/tree/main/packages/turn-fold); implementation is independent.
