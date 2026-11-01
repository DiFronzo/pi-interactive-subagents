/**
 * Rex surface layer: subagents open in their own Rex tab instead of a tmux pane.
 *
 * Rex (https://www.superlogical.com/rex) is a multiplexer with tabs ("windows").
 * Every terminal Rex opens has REX_SESSION and REX_BLOCK set and a `rex` binary on
 * PATH, so a pi running in Rex can drive the CLI with no further setup.
 *
 * A surface here is a Rex block id (`block:<uuid>`). The tmux layer in tmux.ts
 * dispatches to this file for any surface with that prefix.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const REX_SURFACE_PREFIX = "block:";

let rexBinaryAvailable: boolean | undefined;

function hasRexBinary(): boolean {
  if (rexBinaryAvailable === undefined) {
    try {
      execFileSync("sh", ["-c", "command -v rex"], { stdio: "ignore" });
      rexBinaryAvailable = true;
    } catch {
      rexBinaryAvailable = false;
    }
  }
  return rexBinaryAvailable;
}

/** True when pi runs inside a Rex terminal and the `rex` CLI is on PATH. */
export function isRexAvailable(): boolean {
  return !!process.env.REX_BLOCK && hasRexBinary();
}

export function isRexSurface(surface: string): boolean {
  return surface.startsWith(REX_SURFACE_PREFIX);
}

function rex(args: string[]): string {
  return execFileSync("rex", args, { encoding: "utf8" });
}

/** Subagent labels become Rex window labels; keep them short and printable. */
function windowLabel(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `pi-${cleaned || "subagent"}`.slice(0, 40);
}

/**
 * Open a new tab with a login shell and return the id of its terminal block.
 * `--focus=false` keeps the user's active tab in front, the same guarantee the
 * tmux split gives with `-d`.
 */
export function createRexTab(name: string): string {
  const args = ["window", "new", windowLabel(name), "--json", "--focus=false"];
  const session = process.env.REX_SESSION;
  if (session) {
    args.push("-s", session);
  }
  const created = JSON.parse(rex(args)) as { block_ids?: string[] };
  const block = created.block_ids?.[0];
  if (!block || !block.startsWith(REX_SURFACE_PREFIX)) {
    throw new Error(`Unexpected rex window new output: ${JSON.stringify(created)}`);
  }
  return block;
}

/** Open a block beside the last one in pi's row, so subagents sit side by side like tmux panes. */
export function createRexSurface(name: string): string {
  if (process.env.PI_SUBAGENT_REX_LAYOUT === "tab" || !process.env.REX_SESSION || !process.env.REX_BLOCK) {
    return createRexTab(name);
  }
  const pi = process.env.REX_BLOCK;
  try {
    // A plain row (pi on the left of horizontal splits) lets the subagent join its right end.
    // Anything else, such as pi on the left of a stack, still gets a split right beside pi's
    // own block: the subagent stays in pi's tab and the row is simply not rebalanced.
    const row = findRow(pi);
    const target = row ? row.leaves[row.leaves.length - 1] : pi;
    const created = JSON.parse(
      rex(["split", "-b", target, "--split=right", "--focus=false", "--label", windowLabel(name), "--json"]),
    ) as { block_ids?: string[] };
    const block = created.block_ids?.[0];
    if (!block || !block.startsWith(REX_SURFACE_PREFIX)) {
      throw new Error(`Unexpected rex split output: ${JSON.stringify(created)}`);
    }
    rebalanceRow();
    return block;
  } catch (error) {
    // The split itself failed: a tab is always safe.
    if (process.env.PI_SUBAGENT_DEBUG) {
      process.stderr.write(`rex split failed, opening a tab instead: ${String(error)}\n`);
    }
    return createRexTab(name);
  }
}

// ── Layout ──

type LayoutNode = {
  block_id?: string;
  split?: { direction: string; before: LayoutNode; after: LayoutNode };
};

type SessionView = {
  windows?: Array<{ layers?: Array<{ kind?: string; layout?: LayoutNode; blocks?: Array<{ block_id: string }> }> }>;
};

function sessionView(): SessionView {
  return JSON.parse(rex(["api", "call", "-s", process.env.REX_SESSION!, "session.view"])) as SessionView;
}

/**
 * The blocks of pi's row, left to right, when the window is a plain row of
 * side-by-side blocks that contains pi. Null for any other shape.
 */
function findRow(pi: string): { leaves: string[] } | null {
  for (const win of sessionView().windows ?? []) {
    const layer = (win.layers ?? []).find((l) => l.kind === "tiled" && l.blocks?.some((b) => b.block_id === pi));
    if (!layer?.layout) continue;
    let node: LayoutNode | undefined = layer.layout;
    const leaves: string[] = [];
    while (node) {
      if (node.block_id) {
        leaves.push(node.block_id);
        break;
      }
      const s = node.split;
      if (!s || s.direction !== "horizontal" || !s.before?.block_id) return null;
      leaves.push(s.before.block_id);
      node = s.after;
    }
    return leaves.includes(pi) ? { leaves } : null;
  }
  return null;
}

/**
 * Give every block of pi's row the same width, by setting each border to its
 * share of the space to its right (border i of n gets 1/(n-i)). Best effort.
 */
export function rebalanceRow(): void {
  const pi = process.env.REX_BLOCK;
  if (!pi || !process.env.REX_SESSION) return;
  try {
    const row = findRow(pi);
    if (!row) return;
    const n = row.leaves.length;
    for (let i = 0; i < n - 1; i++) {
      rex([
        "api",
        "call",
        "-s",
        process.env.REX_SESSION,
        "session.resize_pane",
        JSON.stringify({
          direction: "horizontal",
          before_block_id: row.leaves[i],
          after_block_id: row.leaves[i + 1],
          ratio: 1 / (n - i),
        }),
      ]);
    }
  } catch {
    // A layout that changed under us is only cosmetic.
  }
}

/** Type a command into a block and press Enter. `--` keeps leading dashes literal. */
export function sendRexCommand(surface: string, command: string): void {
  rex(["send", "-b", surface, "--", command]);
  rex(["send-key", "-b", surface, "enter"]);
}

/** Last `lines` lines of the block's screen and scrollback, like tmux capture-pane. */
function tail(text: string, lines: number): string {
  const all = text.split("\n");
  return all.slice(Math.max(0, all.length - Math.max(1, lines))).join("\n");
}

export function readRexScreen(surface: string, lines: number): string {
  return tail(rex(["capture", "-b", surface, "--trim"]), lines);
}

export async function readRexScreenAsync(surface: string, lines: number): Promise<string> {
  const { stdout } = await execFileAsync("rex", ["capture", "-b", surface, "--trim"], { encoding: "utf8" });
  return tail(stdout, lines);
}

/** Close the block. Closing a tab's last block closes the tab too. */
export function closeRexSurface(surface: string): void {
  rex(["block", "close", surface]);
  // The freed space goes to the neighbours; even the row out again (best effort).
  rebalanceRow();
}
