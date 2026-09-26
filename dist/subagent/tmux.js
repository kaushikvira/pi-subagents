import { execFileSync } from "node:child_process";
import { buildTmuxSplitWindowArgs, chooseTmuxSplitDirection } from "../helpers.js";
function tmuxCmd(args) {
    return execFileSync("tmux", args, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}
function tmuxCmdQuiet(args) {
    try {
        return tmuxCmd(args);
    }
    catch {
        return "";
    }
}
// ─── Pane-existence TTL cache ─────────────────────────────────────────────────
//
// `paneExists`/`paneDead` are called once per task on the 10s background poll
// and up to twice per second on foreground waits, each an execFileSync("tmux")
// that blocks the main thread. These are existence checks on slowly-changing
// state, so the raw `display-message` result is cached per pane id for a short
// TTL. Decision-critical callers (steer, restore, failure diagnostics) pass
// `fresh: true` to force a live check; the decision logic itself is unchanged.
const TMUX_PANE_CHECK_TTL_MS = 5_000;
const paneCheckCache = new Map();
function tmuxDisplayPane(paneId, format, options) {
    const key = `${paneId}\u0000${format}`;
    const now = Date.now();
    if (!options?.fresh) {
        const hit = paneCheckCache.get(key);
        if (hit && now - hit.at < TMUX_PANE_CHECK_TTL_MS)
            return hit.result;
    }
    const result = tmuxCmdQuiet(["display-message", "-p", "-t", paneId, format]);
    paneCheckCache.set(key, { at: now, result });
    if (paneCheckCache.size > 512) {
        for (const [cachedKey, cached] of paneCheckCache) {
            if (now - cached.at >= TMUX_PANE_CHECK_TTL_MS)
                paneCheckCache.delete(cachedKey);
        }
    }
    return result;
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
export function hasTmux() {
    try {
        execFileSync("tmux", ["-V"], { stdio: "ignore" });
        if (!process.env.TMUX)
            return false;
        tmuxCmd(["display-message", "-p", "#{pane_id}"]);
        return true;
    }
    catch {
        return false;
    }
}
function getCurrentPaneId() {
    return tmuxCmdQuiet(["display-message", "-p", "#{pane_id}"]) || null;
}
function getCurrentPaneSize(targetPane) {
    const args = ["display-message", "-p", "#{pane_width} #{pane_height}"];
    if (targetPane)
        args.splice(1, 0, "-t", targetPane);
    const raw = tmuxCmdQuiet(args);
    const [widthRaw, heightRaw] = raw.trim().split(/\s+/, 2);
    const width = Number(widthRaw);
    const height = Number(heightRaw);
    if (!Number.isFinite(width) || !Number.isFinite(height))
        return null;
    return { width, height };
}
export function splitWindowPane(cwd, command) {
    const originalPane = getCurrentPaneId();
    const paneSize = getCurrentPaneSize(originalPane);
    const direction = chooseTmuxSplitDirection(paneSize?.width ?? 0, paneSize?.height ?? 0, process.env.PI_TASK_TMUX_SPLIT);
    const paneId = tmuxCmd(buildTmuxSplitWindowArgs(cwd, command, direction, originalPane));
    return { paneId, originalPane };
}
export function setPaneRemainOnExit(paneId, enabled) {
    tmuxCmdQuiet([
        "set-option",
        "-p",
        "-t",
        paneId,
        "remain-on-exit",
        enabled ? "on" : "off",
    ]);
}
export function setPaneSelfDestruct(paneId, enabled, delaySeconds = 1) {
    const hook = enabled
        ? `run-shell 'sleep ${Math.max(0, delaySeconds)}; tmux kill-pane -t ${paneId} 2>/dev/null || true'`
        : "";
    tmuxCmdQuiet(["set-hook", "-p", "-t", paneId, "pane-died", hook]);
}
export function paneExists(paneId, options) {
    return tmuxDisplayPane(paneId, "#{pane_id}", options) === paneId;
}
export function paneDead(paneId, options) {
    const value = tmuxDisplayPane(paneId, "#{pane_dead}", options);
    return value === "1" || value === "";
}
export function capturePaneTail(paneId, lines = 80) {
    return tmuxCmdQuiet([
        "capture-pane",
        "-p",
        "-t",
        paneId,
        "-S",
        `-${Math.max(1, lines)}`,
    ]);
}
export function killAgentPane(paneId, originalPane) {
    if (originalPane) {
        try {
            tmuxCmd(["select-pane", "-t", originalPane]);
        }
        catch {
            // Original pane may have been closed; still try to kill the agent pane.
        }
    }
    tmuxCmdQuiet(["kill-pane", "-t", paneId]);
}
/** Inject text into a running subagent pane (steer / follow-up). */
export function tmuxSteerPane(paneId, message) {
    const bufferName = `pi-task-steer-${process.pid}-${Date.now()}`;
    try {
        execFileSync("tmux", ["load-buffer", "-b", bufferName, "-"], {
            input: message,
            stdio: ["pipe", "pipe", "pipe"],
        });
        tmuxCmd(["paste-buffer", "-b", bufferName, "-t", paneId]);
    }
    finally {
        tmuxCmdQuiet(["delete-buffer", "-b", bufferName]);
    }
    tmuxCmd(["send-keys", "-t", paneId, "Enter"]);
}
function sessionWatcherScript(sessionFilePath) {
    const quotedPath = shellQuote(sessionFilePath);
    // Watch a *specific* file so stale sibling files can't trigger premature /exit.
    return `(
  if [ -s ${quotedPath} ]; then
    last_size=$(wc -c < ${quotedPath} 2>/dev/null || echo 0)
  else
    last_size=-1
  fi
  stable=0
  deadline=$(( $(date +%s) + 86400 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if [ -s ${quotedPath} ]; then
      size=$(wc -c < ${quotedPath} 2>/dev/null || echo 0)
      if [ "$size" = "$last_size" ]; then
        stable=$((stable + 1))
      else
        stable=0
        last_size=$size
      fi
      if [ "$stable" -ge 3 ]; then
        tmux send-keys -t "$TMUX_PANE" /exit Enter 2>/dev/null || true
        sleep 0.2
        tmux send-keys -t "$TMUX_PANE" 'exit 0' Enter 2>/dev/null || true
        sleep 2
        tmux kill-pane -t "$TMUX_PANE" 2>/dev/null || true
        exit 0
      fi
    fi
    sleep 0.5
  done
) & watcher_pid=$!`;
}
export function wrapWithPaneExitWatcher(sessionFilePath, command) {
    const script = `tmux set-option -p -t "$TMUX_PANE" remain-on-exit on 2>/dev/null || true
${sessionWatcherScript(sessionFilePath)}
${command}
exit_code=$?
kill "$watcher_pid" 2>/dev/null || true
wait "$watcher_pid" 2>/dev/null || true
if [ "$exit_code" -eq 0 ]; then
  tmux set-hook -p -t "$TMUX_PANE" pane-died '' 2>/dev/null || true
  tmux set-option -p -t "$TMUX_PANE" remain-on-exit off 2>/dev/null || true
  tmux kill-pane -t "$TMUX_PANE" 2>/dev/null || true
fi
exit "$exit_code"`;
    return `sh -c ${shellQuote(script)}`;
}
