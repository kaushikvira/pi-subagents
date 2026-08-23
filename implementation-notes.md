# Implementation notes

## Runtime baseline

The package is a runtime-only fork of `heyhuynhgiabuu/pi-task` `0.3.7`. Consumer repositories own `.pi/agents/`; no profile or parent-system policy is bundled. `src/task-runtime.ts` wraps the in-repo task extension, so orchestration hooks can remain additive while the base task implementation continues to own Pi session/process behavior.

## 0.5 architecture decisions — 2026-07-23

### Durable state is not telemetry

`runs.json`, leases, contexts and `events.jsonl` are local correctness state. The telemetry opt-out removes optional aggregate fields only. Runtime caches (`activeRuns`, Herdr group maps, Cron objects) can always be reconstructed or safely abandoned from durable records.

### Three independent outcomes

Execution, verification and review are not collapsed into one status. In particular:

- a failed child is never recorded as completed because proof was absent;
- a verification failure is not rewritten as an execution failure;
- awaiting review is not failure;
- final success is not sent before background verification completes.

### Identity and ownership

Caller correlation IDs are labels. Runtime-generated invocation IDs, canonical task IDs, RPC ownership handles and persisted Herdr terminal IDs establish authority. Reviews require a real distinct completed reviewer task and current subject-session digest.

### Write isolation

A global dirty-tree scan cannot attribute concurrent work. Completion claim checks therefore consume worktree changed-path receipts. Shared cwd remains available for reads/single low-risk writers, but worktree isolation is the supported parallel-write boundary. It is still not an OS sandbox.

### Pi tool interception

Built-in `edit` and `write` tools are guarded through Pi's global `tool_call` event. Wrapping `registerTool` on the upstream extension cannot observe built-ins registered by Pi itself.

## Herdr backend

- CLI wrappers remain the primary transport because they inherit named-session/socket behavior and stable JSON envelopes.
- `HerdrClient` centralizes typed result/error parsing, aborts, timeouts, capability probes, agent waits, metadata and worktree helpers.
- Pane IDs are session-local. Safe control binds absolute socket, parent pane, pane ID, terminal ID, agent name and workspace/tab identity.
- Prompt/steer uses atomic `herdr agent prompt`; the old raw `send-text`, delay, and Enter sequence was removed.
- Herdr status wakes reconciliation only. The child Pi JSONL stop reason and final assistant message remain authoritative.
- Missing Herdr context may fall back. A live-context control outage is surfaced rather than silently duplicating work on tmux/SDK.
- Allocation retries are serialized, bounded and limited to classified transient failures.
- Background waits are interruption-tolerant; periodic JSONL reconciliation remains the safety net.
- Metadata is display-only and never takes lifecycle authority from Herdr's Pi integration.
- Cleanup is parent-owned and verifies terminal identity before closing resources.

## Performance hot paths

- Session JSONL reads (stop reason, last assistant text, tool-use stats) go through an incremental tail cache (`src/session-tail-cache.ts`): per-file byte offset + parsed lines in a module-level cache; polls read only appended bytes and re-read fully on shrink/replacement. Bounded by `MAX_CACHED_SESSION_BYTES` (256 MiB, LRU eviction by last poll).
- Tmux pane-existence checks are TTL-cached (`TMUX_PANE_CHECK_TTL_MS` = 5 s in `src/subagent/tmux.ts`) so the 1 s / 10 s polls stop blocking the main thread on `execFileSync` per task; decision-critical callers (steer, restore, failure diagnostics) force a fresh check.
- The run store prunes terminal runs lazily on write when the store exceeds `RUN_STORE_MAX_RUNS` (1,000): terminal runs older than `RUN_STORE_RETENTION_MS` (7 days) are dropped first, then the oldest prunable terminal runs down to the cap. Runs with an unexpired lease or a pending durable decision are never pruned.
- Orchestration journal rotation keeps at most `MAX_ROTATED_SEGMENTS` (10) rotated 4 MiB segments — the oldest are deleted on rotation, and readers load only live + the newest 10 (a replay cursor whose window was deleted fails with "journal was truncated").

## Scheduling and RPC

Schedules persist before Cron installation, use protected non-overlapping callbacks, and remove their own schedule field before invocation to prevent recursion. RPC protocol v3 creates opaque recursive scopes, freezes scopes before cancellation, stops descendants first, and reports unsettled/failure details instead of returning optimistic success.

## Child process boundary

`PI_TASK_TOOL_DISABLED=1` disables the base task tool. The wrapper also skips `task_control`, commands, schedules, RPC, timers and parent guards. The child allowlist removes both task and control tool names. This avoids recursive manager/timer leaks and prevents children from releasing or reviewing parent-owned work.

## Verification

The repository test matrix covers SDK/tmux/Herdr base behavior plus durable run state, worktree provenance, merge/removal, lease renewal, child isolation, Pi `tool_call` guarding, symlink escape, typed Herdr errors, grouped completion, scheduling, RPC ownership, proof/review state, evidence authority, event idempotency, terminal-phase immutability, file-lock heartbeat, allocating-run recovery, terminal-JSONL reconciliation, restore and failure paths. Live Herdr smoke remains necessary for terminal lifecycle behavior that mocks cannot reproduce.

## Durability and recovery

- Correctness events carry idempotency keys so duplicate completion/release/ship/review records cannot accumulate across restarts.
- Terminal execution phases are immutable: `canTransitionExecution` rejects resurrection of a completed/failed/cancelled/timeout run.
- Allocating runs (launch crashed before task ID was assigned) are conservatively rebound to a unique matching durable registry entry at `session_start`.
- Terminal Pi JSONL discovered after a parent restart is reconciled: the stop reason (not just the history status) determines the terminal outcome, and completed tasks are forwarded once before the parent resumes polling.
- File locks heartbeat their mtime and record a process PID so a live long-running operation cannot have its lock stolen by stale-mtime detection.
- Doctor checks are individually wrapped so one corrupt store produces a scoped error issue instead of crashing the entire doctor run.
