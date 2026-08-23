/**
 * Read assistant text from pi JSONL session directories used by task sessions.
 *
 * All reads go through the incremental tail cache (session-tail-cache.ts):
 * only bytes appended since the last poll are read and parsed, so the 1s
 * completion/progress polls and the 3s/10s stats polls no longer pay a full
 * re-read + full re-parse of every session file on every tick.
 */

import { existsSync } from "node:fs";
import {
  matchesJsonlTailViewSessionName,
  readJsonlTailViews,
  type SessionJsonlEntry,
} from "./session-tail-cache.js";

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("\n")
    .trim();
}

/**
 * Whether a parsed line passes the `sinceMs` timestamp filter, with the same
 * semantics as the original per-line scan: lines without a timestamp are
 * always kept, and only finite timestamps before `sinceMs` are dropped.
 */
function passesSinceFilter(entry: SessionJsonlEntry, sinceMs?: number): boolean {
  if (sinceMs === undefined) return true;
  if (typeof entry.timestamp !== "string" || !entry.timestamp) return true;
  const timestampMs = Date.parse(entry.timestamp);
  return !(Number.isFinite(timestampMs) && timestampMs < sinceMs);
}

/**
 * Whether the subagent has finished producing responses.
 *
 * The reliable completion signal is the last assistant message's stopReason.
 * - "toolUse": the agent called tools and should continue, so it is not done.
 * - "stop" / "endTurn" / "length" / "error" / "aborted": terminal.
 * - no assistant messages or no stopReason yet: not done.
 */
export function getAgentTerminalStopReason(
  sessionDir: string,
  sessionName?: string,
  sinceMs?: number,
): string | undefined {
  if (!existsSync(sessionDir)) return undefined;

  const views = readJsonlTailViews(sessionDir);

  let lastStopReason: string | undefined;
  for (const view of views) {
    if (!matchesJsonlTailViewSessionName(view, sessionName)) continue;
    for (const entry of view.entries) {
      if (entry.type !== "message") continue;
      if (!passesSinceFilter(entry, sinceMs)) continue;
      const msg = entry.message;
      if (msg?.role === "assistant" && typeof msg.stopReason === "string") {
        lastStopReason = msg.stopReason;
      }
    }
  }
  return lastStopReason && lastStopReason !== "toolUse"
    ? lastStopReason
    : undefined;
}

export function hasAgentFinished(
  sessionDir: string,
  sessionName?: string,
  sinceMs?: number,
): boolean {
  const stopReason = getAgentTerminalStopReason(sessionDir, sessionName, sinceMs);
  return (
    stopReason !== undefined &&
    ["stop", "endTurn", "length", "error", "aborted"].includes(stopReason)
  );
}

/**
 * Last non-empty assistant message from matching .jsonl files in sessionDir.
 */
export function getLastAssistantTextFromSessionDir(
  sessionDir: string,
  sessionName?: string,
  sinceMs?: number,
): string {
  if (!existsSync(sessionDir)) return "";

  const views = readJsonlTailViews(sessionDir);

  let last = "";
  for (const view of views) {
    if (!matchesJsonlTailViewSessionName(view, sessionName)) continue;

    for (const entry of view.entries) {
      if (entry.type !== "message") continue;
      if (!passesSinceFilter(entry, sinceMs)) continue;
      const msg = entry.message;
      if (!msg || msg.role !== "assistant") continue;
      const text = extractText(msg.content);
      if (text) last = text;
    }
  }
  return last;
}