import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  clearSessionTailCache,
  readJsonlTailViews,
  matchesJsonlTailViewSessionName,
} from "../src/session-tail-cache.js";
import {
  getAgentTerminalStopReason,
  getLastAssistantTextFromSessionDir,
  hasAgentFinished,
} from "../src/session-text.js";
import { countToolUses, readRecentToolCalls } from "../src/helpers.js";

function makeSessionDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-task-tail-cache-"));
}

function writeLines(dir: string, file: string, lines: unknown[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, file),
    lines.map((line) => JSON.stringify(line)).join("\n") + (lines.length ? "\n" : ""),
  );
}

function appendLines(dir: string, file: string, lines: unknown[]): void {
  appendFileSync(
    join(dir, file),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
}

const assistantText = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "message",
  timestamp: new Date().toISOString(),
  message: { role: "assistant", content: [{ type: "text", text }], ...extra },
});

const toolCallMessage = (id: string, args: unknown, extra: Record<string, unknown> = {}) => ({
  type: "message",
  timestamp: new Date().toISOString(),
  message: {
    role: "assistant",
    content: [{ type: "toolCall", id, name: "read", arguments: args }],
    ...extra,
  },
});

describe("session JSONL tail cache", () => {
  it("sees exactly the lines a fresh read sees, across multiple files", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "b.jsonl", [
      { type: "session_info", name: "sess-b" },
      assistantText("from-b"),
    ]);
    writeLines(sessionDir, "a.jsonl", [
      { type: "session_info", name: "sess-a" },
      assistantText("from-a"),
    ]);
    clearSessionTailCache();

    const views = readJsonlTailViews(sessionDir);
    assert.deepEqual(
      views.map((view) => view.name),
      ["a.jsonl", "b.jsonl"],
    );
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "sess-b"), "from-b");
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir), "from-b");
    assert.equal(getAgentTerminalStopReason(sessionDir), undefined);
  });

  it("picks up appended lines incrementally without re-reading", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      assistantText("first"),
    ]);
    clearSessionTailCache();

    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "first");

    // A later poll must see the appended line. The cache holds the prior
    // lines, so this is only observable if the tail is read incrementally.
    appendLines(sessionDir, "s.jsonl", [
      assistantText("second"),
      { type: "message", timestamp: new Date().toISOString(), message: { role: "assistant", stopReason: "stop", content: [] } },
    ]);
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "second");
    assert.equal(hasAgentFinished(sessionDir, "s"), true);
    assert.equal(getAgentTerminalStopReason(sessionDir, "s"), "stop");
  });

  it("re-reads a file fully when it shrinks (rotation/compaction)", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      assistantText("old-line"),
      assistantText("older-line"),
    ]);
    clearSessionTailCache();
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "older-line");

    // Compaction: the file is replaced by a shorter one.
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      assistantText("compacted"),
    ]);
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "compacted");
  });

  it("re-reads a file fully when it is replaced at the same size", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      assistantText("aaaa"),
    ]);
    clearSessionTailCache();
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "aaaa");

    // Same-size rewrite with a newer mtime: content must not be assumed.
    const previousSize = statSync(join(sessionDir, "s.jsonl")).size;
    const swapped = [
      { type: "session_info", name: "s" },
      assistantText("bbbb"),
    ]
      .map((line) => JSON.stringify(line))
      .join("\n") + "\n";
    writeFileSync(join(sessionDir, "s.jsonl"), paddedTo(swapped, previousSize));
    const times = new Date(Date.now() + 5_000);
    utimesSync(join(sessionDir, "s.jsonl"), times, times);
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "bbbb");
  });

  it("re-reads a file fully when it is replaced by a new inode", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      assistantText("original"),
    ]);
    clearSessionTailCache();
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "original");

    // Rotation via rename: a brand-new file under the same name.
    writeLines(dir, "replacement.jsonl", [
      { type: "session_info", name: "s" },
      assistantText("rotated-in"),
    ]);
    renameSync(join(dir, "replacement.jsonl"), join(sessionDir, "s.jsonl"));
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "rotated-in");
  });

  it("stops seeing lines for a file that vanished from the directory", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      assistantText("from-s"),
    ]);
    writeLines(sessionDir, "other.jsonl", [
      { type: "session_info", name: "other" },
      assistantText("from-other"),
    ]);
    clearSessionTailCache();
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir), "from-s");

    rmSync(join(sessionDir, "other.jsonl"));
    // s.jsonl sorts after other.jsonl was removed: its last text must win.
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir), "from-s");
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "other"), "");
  });

  it("skips malformed lines and non-object lines exactly like a fresh read", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "s.jsonl"),
      [
        JSON.stringify({ type: "session_info", name: "s" }),
        "this is not json",
        "null",
        JSON.stringify(assistantText("ok-line")),
        "42",
      ].join("\n") + "\n",
    );
    clearSessionTailCache();
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "ok-line");

    // Append after the malformed lines: still consistent.
    appendLines(sessionDir, "s.jsonl", [assistantText("still-ok")]);
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "still-ok");
  });

  it("resolves session names from the FIRST session_info line only", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "first" },
      { type: "session_info", name: "second" },
      assistantText("text"),
    ]);
    clearSessionTailCache();

    const views = readJsonlTailViews(sessionDir);
    assert.equal(matchesJsonlTailViewSessionName(views[0]!, "first"), true);
    assert.equal(matchesJsonlTailViewSessionName(views[0]!, "second"), false);
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "first"), "text");
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "second"), "");
  });

  it("treats a file without session_info as unmatched for named queries", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [assistantText("anonymous")]);
    clearSessionTailCache();

    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "named"), "");
    // Unnamed queries still see the lines.
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir), "anonymous");
  });

  it("applies sinceMs filters identically to a fresh read, including cache invalidation on change", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      { type: "message", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", stopReason: "stop" } },
    ]);
    clearSessionTailCache();

    const before = t0 - 1000;
    assert.equal(getAgentTerminalStopReason(sessionDir, "s", before), "stop");
    // Boundary: the message is AT t0+1000, and the original filter keeps
    // timestamps that are not strictly before sinceMs.
    assert.equal(getAgentTerminalStopReason(sessionDir, "s", t0 + 1000), "stop");
    // A newer sinceMs excludes the old message — even though the file is
    // unchanged and fully cached.
    assert.equal(getAgentTerminalStopReason(sessionDir, "s", t0 + 2000), undefined);
    // Back to the older sinceMs: the cached lines must still be filterable.
    assert.equal(getAgentTerminalStopReason(sessionDir, "s", before), "stop");
  });

  it("keeps tool-use counts and recent calls correct across incremental appends", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      toolCallMessage("call-1", { path: "a.txt" }),
      {
        type: "message",
        timestamp: new Date().toISOString(),
        message: { role: "toolResult", toolCallId: "call-1", isError: false },
      },
    ]);
    clearSessionTailCache();

    const first = countToolUses(sessionDir, "s");
    assert.deepEqual(first, { toolUses: 1, turns: 1 });
    const recentFirst = readRecentToolCalls(sessionDir, 12, "s");
    assert.deepEqual(recentFirst.recent, [
      { name: "read", detail: "a.txt", id: "call-1", status: "done" },
    ]);

    appendLines(sessionDir, "s.jsonl", [
      toolCallMessage("call-2", { path: "b.txt" }),
    ]);
    const second = countToolUses(sessionDir, "s");
    assert.deepEqual(second, { toolUses: 2, turns: 2 });
    const recentSecond = readRecentToolCalls(sessionDir, 1, "s");
    assert.deepEqual(recentSecond.recent, [
      { name: "read", detail: "b.txt", id: "call-2", status: "in_progress" },
    ]);
  });

  it("handles UTF-8 multibyte content without desyncing the tail offset", () => {
    const dir = makeSessionDir();
    const sessionDir = join(dir, "sessions");
    writeLines(sessionDir, "s.jsonl", [
      { type: "session_info", name: "s" },
      assistantText("日本語のテキスト"),
    ]);
    clearSessionTailCache();
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "日本語のテキスト");

    appendLines(sessionDir, "s.jsonl", [assistantText("møøse åæø")]);
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "møøse åæø");
    appendLines(sessionDir, "s.jsonl", [assistantText("final ✓")]);
    assert.equal(getLastAssistantTextFromSessionDir(sessionDir, "s"), "final ✓");
  });
});

function paddedTo(content: string, size: number): string {
  if (Buffer.byteLength(content, "utf8") >= size) return content;
  return content + " ".repeat(size - Buffer.byteLength(content, "utf8"));
}