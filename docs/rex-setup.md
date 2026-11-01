# Running pi subagents beside pi in Rex

This guide sets up the Rex backend of `pi-interactive-subagents-rex` so that each
subagent opens as a pane **beside pi in the same Rex tab**, instead of a new tab.

## Requirements

- [Rex](https://www.superlogical.com/rex) with its `rex` command on `PATH`.
  Check with `which rex`.
- [pi](https://github.com/badlogic/pi-mono) (`@earendil-works/pi-coding-agent`).
- This repository, cloned locally.

## 1. Install the extension from the local clone

Install from the path, not from git, so `pi update` does not overwrite the local change:

```bash
pi install /path/to/pi-interactive-subagents-rex
```

This adds the path to `packages` in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "/path/to/pi-interactive-subagents-rex"
  ]
}
```

## 2. Start pi inside a Rex block

The backend only activates when Rex has set these variables for the pi process:

- `REX_BLOCK` (the block pi runs in)
- `REX_SESSION` (the Rex session)

Start pi from a Rex terminal block, not from a plain shell or tmux. Rex sets both
variables for you. Check inside pi's shell with `echo $REX_BLOCK $REX_SESSION`.

## 3. Keep pi's tab a plain layout

Layout does not decide whether a subagent stays in the tab any more: if the
row cannot be read, the subagent splits directly beside pi's block. Any layout
still works. Only an even-width rebalance is skipped in a stacked layout.

## 4. Check the layout

1. Reload pi (`/reload`) or restart it so the extension loads the new code.
2. Start a subagent that stays open for a while, for example one that runs
   `sleep 60`.
3. Look at the Rex tab: the subagent's pane should sit beside pi, in the same tab.

## Environment variables

| Variable | Effect |
|---|---|
| `PI_SUBAGENT_REX_LAYOUT=tab` | Open every subagent in its own tab (old behaviour). |
| `PI_SUBAGENT_DEBUG=1` | Log to stderr why a split fell back to a tab. |

Unset `PI_SUBAGENT_REX_LAYOUT` for the default split behaviour.

## Troubleshooting

- **Subagent opens in a new tab.** Run with `PI_SUBAGENT_DEBUG=1` and read the
  stderr line `rex split failed, opening a tab instead`. Also confirm
  `PI_SUBAGENT_REX_LAYOUT` is not set in the environment of the pi process.
- **Subagent opens in tmux, not Rex.** `REX_BLOCK`, `REX_SESSION` or `rex` on
  `PATH` is missing in the pi process. Start pi from a Rex block.
- **Old layout after editing the code.** pi loads the extension at startup. Run
  `/reload` or restart pi.

## Notes

- Changes are in `pi-extension/subagents/rex.ts` (`createRexSurface()`).
- The unit tests (`node --test test/test.ts test/system-prompt-mode.test.ts`) do not
  cover the Rex split path. Verify with a live subagent, as in step 4.
