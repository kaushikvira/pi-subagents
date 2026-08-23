import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { paneDead, paneExists } from "../src/subagent/tmux.js";

/**
 * The pane-existence TTL cache is tested through a fake `tmux` executable on
 * PATH that counts its invocations. The cache lives in the tmux module, so
 * each `it` uses a distinct pane id.
 */

const root = mkdtempSync(join(tmpdir(), "pi-task-tmux-cache-"));
const binDirectory = join(root, "bin");
const countFile = join(root, "tmux-calls.log");
let originalPath: string | undefined;
let originalCountFile: string | undefined;
let realNow: () => number;

function installFakeTmux(): void {
  mkdirSync(binDirectory, { recursive: true });
  const executable = join(binDirectory, "tmux");
  writeFileSync(
    executable,
    `#!/bin/sh
# Count display-message invocations (the pane-existence queries).
if [ -n "$TMUX_FAKE_COUNT_FILE" ]; then
  case "$1" in
    display-message) echo x >> "$TMUX_FAKE_COUNT_FILE" ;;
  esac
fi
PANE=""
PREV=""
LAST=""
for arg in "$@"; do
  LAST="$arg"
  case "$arg" in
    -t) PREV="t" ;;
    *) if [ "$PREV" = "t" ]; then PANE="$arg"; fi; PREV="" ;;
  esac
done
case "$LAST" in
  "#{pane_id}") if [ -n "$PANE" ]; then printf '%s\\n' "$PANE"; else printf '\\n'; fi ;;
  "#{pane_dead}") if [ -n "$PANE" ]; then printf '0\\n'; else printf '\\n'; fi ;;
  "#{pane_width} #{pane_height}") printf '120 40\\n' ;;
  *) : ;;
esac
`,
  );
  chmodSync(executable, 0o755);
}

function callCount(): number {
  if (!existsSync(countFile)) return 0;
  return readFileSync(countFile, "utf8").split("\n").filter(Boolean).length;
}

function resetCount(): void {
  rmSync(countFile, { force: true });
}

before(() => {
  installFakeTmux();
  originalPath = process.env.PATH;
  originalCountFile = process.env.TMUX_FAKE_COUNT_FILE;
  process.env.PATH = `${binDirectory}:${originalPath ?? ""}`;
  process.env.TMUX_FAKE_COUNT_FILE = countFile;
  realNow = Date.now;
  Date.now = () => 1_000_000;
  resetCount();
});

after(() => {
  process.env.PATH = originalPath;
  if (originalCountFile === undefined) delete process.env.TMUX_FAKE_COUNT_FILE;
  else process.env.TMUX_FAKE_COUNT_FILE = originalCountFile;
  Date.now = realNow;
  rmSync(root, { recursive: true, force: true });
});

describe("tmux pane-existence TTL cache", () => {
  it("serves repeated polls from the cache and execs once", () => {
    resetCount();

    assert.equal(paneExists("%poll-1"), true);
    assert.equal(callCount(), 1);
    // Subsequent polls inside the TTL window must not exec tmux again.
    assert.equal(paneExists("%poll-1"), true);
    assert.equal(paneExists("%poll-1"), true);
    assert.equal(callCount(), 1);
  });

  it("keeps distinct queries in separate cache entries", () => {
    resetCount();

    // paneDead uses a different format string: its own cache entry.
    assert.equal(paneDead("%poll-2"), false);
    assert.equal(callCount(), 1);
    assert.equal(paneDead("%poll-2"), false);
    assert.equal(paneExists("%poll-2"), true);
    assert.equal(callCount(), 2);
  });

  it("forces a live check for decision-critical callers", () => {
    resetCount();

    assert.equal(paneExists("%poll-3"), true);
    assert.equal(callCount(), 1);
    assert.equal(paneExists("%poll-3", { fresh: true }), true);
    assert.equal(callCount(), 2);
  });

  it("serves cached results within the TTL and re-checks after it expires", () => {
    resetCount();

    assert.equal(paneExists("%poll-4"), true);
    assert.equal(callCount(), 1);

    // 4.9s later: still inside the 5s TTL — no exec.
    Date.now = () => 1_000_000 + 4_900;
    assert.equal(paneExists("%poll-4"), true);
    assert.equal(callCount(), 1);

    // 5.1s later: expired — a live exec must happen.
    Date.now = () => 1_000_000 + 5_100;
    assert.equal(paneExists("%poll-4"), true);
    assert.equal(callCount(), 2);
    Date.now = () => 1_000_000;
  });
});