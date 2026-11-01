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
}
