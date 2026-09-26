import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, truncate, unlink, writeFile, } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { withFileLock } from "./file-lock.js";
import { normalizeOrchestrationReason, } from "./reason-codes.js";
export const ORCHESTRATION_EVENT_VERSION = 1;
/**
 * Every event type, in one place.
 *
 * The union and the runtime type guard used to be written out separately, and
 * the guard rejects anything it does not list — while the writer validates
 * nothing. Adding a type to only one of them therefore produced an event that
 * appended cleanly and then made every subsequent read of the journal throw,
 * which in turn fails the write guard closed and blocks all writes. Deriving
 * both from this array removes the possibility.
 */
export const ORCHESTRATION_EVENT_TYPES = [
    "task_started",
    "task_resumed",
    "task_execution_completed",
    "task_completed",
    "task_failed",
    "task_cancelled",
    "task_timed_out",
    "task_outcome_reported",
    "task_awaiting_decision",
    "decision_requested",
    "decision_responded",
    "task_awaiting_review",
    "claim_acquired",
    "claim_released",
    "claim_lease_lost",
    "claim_store_quarantined",
    "handoff_updated",
    "proof_passed",
    "proof_failed",
    "review_completed",
    "task_reviewed",
    "task_shipped",
    "task_ship_blocked",
    "task_worktree_merged",
    "task_worktree_removed",
];
/**
 * Rotate the journal once the live segment passes this size. Appending is
 * O(1) regardless, but every reader (metrics, doctor, replay, review dedup)
 * parses whatever is live, so an unbounded file degrades them all.
 */
export const MAX_SEGMENT_BYTES = 4 * 1024 * 1024;
/**
 * Rotated segments are kept only while at most this many exist. The journal
 * used to rotate 4 MB segments forever: disk grew without bound and every
 * reader (replay, review dedup, metrics, doctor) parsed every segment ever
 * written. Rotation now deletes the oldest segments past this cap, and the
 * readers below only ever load live + the newest `MAX_ROTATED_SEGMENTS`
 * rotated segments.
 */
export const MAX_ROTATED_SEGMENTS = 10;
/**
 * Append one event to the journal.
 *
 * The two things an append needs to know — the next sequence number, and
 * whether this idempotency key has been used — used to be answered by reading
 * and parsing the entire journal, inside the lock, on every single append. That
 * is quadratic in the number of events, and the cost is paid while holding a
 * lock other processes wait 5 seconds for. A long-running project eventually
 * crosses the point where they always time out, and since the write guard fails
 * closed on a telemetry error, "the journal got big" turns into "no agent can
 * write to the repository". Both answers now come from a small sidecar index.
 */
export async function appendOrchestrationEvent(input) {
    // The lifecycle journal is correctness state and is always persisted. The
    // telemetry opt-out removes optional usage/performance fields only; it must
    // never disable recovery, leases, proof, review, or ship-gate state.
    const eventInput = process.env.PI_SUBAGENTS_NO_TELEMETRY === "1"
        ? withoutOptionalMetrics(input.event)
        : input.event;
    let persisted;
    await mkdir(dirname(input.eventPath), { recursive: true });
    await withFileLock({
        lockPath: `${input.eventPath}.lock`,
        operation: async () => {
            await repairJournalTail(input.eventPath);
            const index = await loadJournalIndex(input.eventPath);
            if (eventInput.idempotencyKey) {
                const existing = index.keyed[eventInput.idempotencyKey];
                if (existing) {
                    persisted = existing;
                    return;
                }
            }
            const event = {
                ...eventInput,
                ...(eventInput.reason !== undefined
                    ? { reason: normalizeOrchestrationReason(eventInput.reason) }
                    : {}),
                version: ORCHESTRATION_EVENT_VERSION,
                id: randomUUID(),
                sequence: index.lastSequence + 1,
                timestamp: eventInput.timestamp ?? new Date().toISOString(),
            };
            const line = `${JSON.stringify(event)}\n`;
            await appendAndSync(input.eventPath, line);
            index.lastSequence = event.sequence;
            index.bytes += Buffer.byteLength(line, "utf8");
            if (eventInput.idempotencyKey) {
                index.keyed[eventInput.idempotencyKey] = event;
            }
            if (index.bytes > MAX_SEGMENT_BYTES) {
                await rotateJournal(input.eventPath, index);
            }
            await writeJournalIndex(input.eventPath, index);
            persisted = event;
        },
    });
    if (!persisted)
        throw new Error("Orchestration event was not persisted");
    return persisted;
}
const JOURNAL_INDEX_VERSION = 1;
function journalIndexPath(eventPath) {
    return `${eventPath}.index.json`;
}
async function loadJournalIndex(eventPath) {
    const liveBytes = await fileSize(eventPath);
    try {
        const value = JSON.parse(await readFile(journalIndexPath(eventPath), "utf8"));
        if (isJournalIndex(value) && value.bytes === liveBytes) {
            return value;
        }
    }
    catch {
        // Missing, unreadable, or stale — rebuilt below.
    }
    return rebuildJournalIndex(eventPath, liveBytes);
}
/**
 * Rebuild the index by scanning the live segment. Rotated segments are counted
 * for the sequence high-water mark only, so sequences stay monotonic across a
 * rotation without keeping every historical key in memory.
 */
async function rebuildJournalIndex(eventPath, liveBytes) {
    // Sequences are monotonic in append order, so the high-water mark lives in
    // the most recent segments; the retention cap bounds how far back a rebuild
    // (or any reader) ever has to scan.
    const segments = (await listRotatedSegments(eventPath)).slice(-MAX_ROTATED_SEGMENTS);
    let lastSequence = 0;
    for (const segment of segments) {
        for (const event of await readSegment(segment.path)) {
            lastSequence = Math.max(lastSequence, event.sequence);
        }
    }
    const keyed = {};
    for (const event of await readSegment(eventPath)) {
        lastSequence = Math.max(lastSequence, event.sequence);
        if (event.idempotencyKey)
            keyed[event.idempotencyKey] = event;
    }
    return {
        version: JOURNAL_INDEX_VERSION,
        generation: (segments.at(-1)?.generation ?? 0) + 1,
        lastSequence,
        bytes: liveBytes,
        keyed,
    };
}
async function writeJournalIndex(eventPath, index) {
    const path = journalIndexPath(eventPath);
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(index)}\n`, "utf8");
    await rename(temporaryPath, path);
}
/**
 * Move the live segment aside and start an empty one.
 *
 * Idempotency keys are dropped with the segment. They are scoped to a single
 * invocation and rotation happens after megabytes of events, so a key that
 * survives long enough to be replayed across a rotation is not a case that
 * arises — and keeping every key forever is the unbounded growth being fixed.
 */
async function rotateJournal(eventPath, index) {
    await rename(eventPath, rotatedSegmentPath(eventPath, index.generation));
    index.generation += 1;
    index.bytes = 0;
    index.keyed = {};
    await pruneRotatedSegments(eventPath);
}
/**
 * Delete rotated segments beyond the retention cap (keep the newest
 * `MAX_ROTATED_SEGMENTS`). Runs under the journal lock, on rotation only.
 */
async function pruneRotatedSegments(eventPath) {
    const segments = await listRotatedSegments(eventPath);
    const excess = segments.slice(0, Math.max(0, segments.length - MAX_ROTATED_SEGMENTS));
    await Promise.all(excess.map((segment) => unlink(segment.path).catch(() => {
        // Deletion is best-effort: a segment that cannot be deleted (busy,
        // permissions) is retried on the next rotation, and readers only
        // ever load the newest cap, so it never blocks appends.
    })));
}
function rotatedSegmentPath(eventPath, generation) {
    const suffix = extname(eventPath);
    return `${eventPath.slice(0, eventPath.length - suffix.length)}.${generation}${suffix}`;
}
/** Rotated segments for this journal, oldest first. */
async function listRotatedSegments(eventPath) {
    const directory = dirname(eventPath);
    const suffix = extname(eventPath);
    const base = basename(eventPath, suffix);
    const pattern = new RegExp(`^${escapeRegExp(base)}\\.(\\d+)${escapeRegExp(suffix)}$`, "u");
    let entries;
    try {
        entries = await readdir(directory);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return [];
        throw error;
    }
    return entries
        .map((name) => {
        const match = pattern.exec(name);
        return match
            ? { generation: Number(match[1]), path: join(directory, name) }
            : undefined;
    })
        .filter((value) => value !== undefined)
        .sort((a, b) => a.generation - b.generation);
}
async function fileSize(path) {
    try {
        return (await stat(path)).size;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return 0;
        throw error;
    }
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function isJournalIndex(value) {
    return (isRecord(value) &&
        value.version === JOURNAL_INDEX_VERSION &&
        typeof value.generation === "number" &&
        typeof value.lastSequence === "number" &&
        typeof value.bytes === "number" &&
        isRecord(value.keyed));
}
async function appendAndSync(path, contents) {
    const handle = await open(path, "a");
    try {
        await handle.writeFile(contents, "utf8");
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
/**
 * Repair a journal whose last line was cut short by a crash.
 *
 * Reads only the tail. It used to read the whole file to look at the final
 * line — inside the lock, on every append — which is half of what made appends
 * quadratic.
 */
async function repairJournalTail(path) {
    const size = await fileSize(path);
    if (size === 0)
        return;
    // Read backwards in byte-sized windows until a newline turns up, so the
    // common case costs one small read instead of parsing the whole journal.
    // Offsets are tracked in BYTES throughout — a character offset would truncate
    // at the wrong place the moment an event contains a non-ASCII character.
    let windowBytes = Math.min(size, 64 * 1024);
    let lastNewlineByte = -1;
    let tail = "";
    while (true) {
        const start = size - windowBytes;
        const buffer = Buffer.alloc(windowBytes);
        const handle = await open(path, "r");
        try {
            await handle.read(buffer, 0, windowBytes, start);
        }
        finally {
            await handle.close();
        }
        if (buffer.at(-1) === 0x0a)
            return; // Already terminated: nothing to repair.
        const newlineInWindow = buffer.lastIndexOf(0x0a);
        if (newlineInWindow >= 0) {
            lastNewlineByte = start + newlineInWindow;
            tail = buffer.subarray(newlineInWindow + 1).toString("utf8");
            break;
        }
        if (start === 0) {
            // No newline anywhere: the file is a single unterminated line.
            lastNewlineByte = -1;
            tail = buffer.toString("utf8");
            break;
        }
        windowBytes = Math.min(size, windowBytes * 4);
    }
    try {
        const value = JSON.parse(tail);
        if (!isOrchestrationEvent(value))
            throw new Error("invalid event tail");
        await appendAndSync(path, "\n");
    }
    catch {
        await truncate(path, lastNewlineByte + 1);
        const handle = await open(path, "r+");
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
}
/**
 * Every event in the journal, oldest first, across rotated segments.
 *
 * Callers depend on seeing the whole history — replay hashes a prefix chain
 * over it, review dedup looks for an earlier verdict, metrics count from the
 * beginning. Rotation is invisible within the retention window (live + the
 * newest `MAX_ROTATED_SEGMENTS` rotated segments); beyond it, history is
 * deliberately bounded — a replay cursor whose window was deleted fails
 * validation with "journal was truncated" rather than forcing unbounded disk
 * and parse cost on every read.
 */
export async function readOrchestrationEvents(eventPath) {
    const segments = (await listRotatedSegments(eventPath)).slice(-MAX_ROTATED_SEGMENTS);
    if (segments.length === 0)
        return readSegment(eventPath);
    const events = [];
    for (const segment of segments) {
        events.push(...(await readSegment(segment.path)));
    }
    events.push(...(await readSegment(eventPath)));
    return events;
}
async function readSegment(eventPath) {
    try {
        const content = await readFile(eventPath, "utf8");
        const events = [];
        const lines = content.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? "";
            if (!line.trim())
                continue;
            let value;
            try {
                value = JSON.parse(line);
            }
            catch (error) {
                const isCrashTail = index === lines.length - 1 && !content.endsWith("\n");
                if (isCrashTail)
                    break;
                throw error;
            }
            if (!isOrchestrationEvent(value)) {
                throw new Error(`Invalid orchestration event in ${eventPath}`);
            }
            events.push(value);
        }
        return events;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
export async function summarizeTaskSessionUsage(sessionPath) {
    const content = await readFile(sessionPath, "utf8");
    const summary = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: 0,
    };
    for (const line of content.split("\n")) {
        if (!line.trim()) {
            continue;
        }
        const value = JSON.parse(line);
        if (!isRecord(value) || value.type !== "message" || !isRecord(value.message)) {
            continue;
        }
        const message = value.message;
        if (message.role !== "assistant" || !isRecord(message.usage)) {
            continue;
        }
        const usage = message.usage;
        summary.inputTokens += numericValue(usage.input);
        summary.outputTokens += numericValue(usage.output);
        summary.cacheReadTokens += numericValue(usage.cacheRead);
        summary.cacheWriteTokens += numericValue(usage.cacheWrite);
        if (isRecord(usage.cost)) {
            summary.cost += numericValue(usage.cost.total);
        }
        if (typeof message.provider === "string") {
            summary.provider = message.provider;
        }
        if (typeof message.model === "string") {
            summary.model = message.model;
        }
    }
    summary.totalTokens =
        summary.inputTokens +
            summary.outputTokens +
            summary.cacheReadTokens +
            summary.cacheWriteTokens;
    summary.cost = Number(summary.cost.toFixed(12));
    return summary;
}
export function deriveOrchestrationMetrics(input) {
    const now = input.now ?? new Date();
    const staleAfterMs = input.staleAfterMs ?? 30 * 60 * 1_000;
    const starts = input.events.filter((event) => event.type === "task_started");
    const attempts = input.events.filter((event) => event.type === "task_started" || event.type === "task_resumed");
    const completions = input.events.filter((event) => event.type === "task_completed");
    const executionCompletions = input.events.filter((event) => event.type === "task_execution_completed");
    const failures = input.events.filter((event) => event.type === "task_failed" ||
        event.type === "task_cancelled" ||
        event.type === "task_timed_out" ||
        event.type === "proof_failed");
    const terminalTaskIds = new Set([...executionCompletions, ...completions, ...failures]
        .map((event) => event.taskId)
        .filter((taskId) => taskId !== undefined));
    const staleTasks = attempts.filter((event) => event.taskId !== undefined &&
        !terminalTaskIds.has(event.taskId) &&
        now.getTime() - Date.parse(event.timestamp) > staleAfterMs).length;
    const measuredCompletions = executionCompletions.length > 0 ? executionCompletions : completions;
    const totalDurationMs = measuredCompletions.reduce((total, event) => total + (event.durationMs ?? 0), 0);
    const verificationEvents = measuredCompletions.filter((event) => event.verificationPassed !== undefined);
    const reviewEvents = input.events.filter((event) => event.type === "review_completed" && (event.reviewFindings ?? 0) > 0);
    const reviewFindings = reviewEvents.reduce((total, event) => total + (event.reviewFindings ?? 0), 0);
    const acceptedFindings = reviewEvents.reduce((total, event) => total + (event.acceptedFindings ?? 0), 0);
    const totalTokens = input.events.reduce((total, event) => total + (event.usage?.totalTokens ?? 0), 0);
    const totalCost = Number(input.events
        .reduce((total, event) => total + (event.usage?.cost ?? 0), 0)
        .toFixed(12));
    const terminalTasks = completions.length + failures.length;
    return {
        tasksStarted: starts.length,
        tasksCompleted: completions.length,
        tasksFailed: failures.length,
        staleTasks,
        retries: input.events.reduce((total, event) => total + (event.retryCount ?? 0), 0),
        totalDurationMs,
        averageDurationMs: measuredCompletions.length === 0
            ? 0
            : totalDurationMs / measuredCompletions.length,
        totalTokens,
        totalCost,
        verificationPassRate: verificationEvents.length === 0
            ? undefined
            : verificationEvents.filter((event) => event.verificationPassed).length /
                verificationEvents.length,
        reviewYield: reviewFindings === 0 ? undefined : acceptedFindings / reviewFindings,
        taskSuccessRate: terminalTasks === 0 ? undefined : completions.length / terminalTasks,
        tokensPerCompletedTask: completions.length === 0 ? undefined : totalTokens / completions.length,
        costPerCompletedTask: completions.length === 0 ? undefined : totalCost / completions.length,
    };
}
function isOrchestrationEvent(value) {
    return (isRecord(value) &&
        value.version === ORCHESTRATION_EVENT_VERSION &&
        typeof value.id === "string" &&
        typeof value.timestamp === "string" &&
        isEventType(value.type) &&
        typeof value.orchestrationId === "string");
}
function isEventType(value) {
    return ORCHESTRATION_EVENT_TYPES.includes(value);
}
function withoutOptionalMetrics(event) {
    // Retry and review-yield counters are optional operational telemetry; disabling
    // them also disables diagnostics derived exclusively from those counters.
    const correctness = { ...event };
    delete correctness.durationMs;
    delete correctness.retryCount;
    delete correctness.reviewFindings;
    delete correctness.acceptedFindings;
    delete correctness.usage;
    return correctness;
}
function numericValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
