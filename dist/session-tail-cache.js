/**
 * Incremental tail cache for pi JSONL session files.
 *
 * The session-text and tool-stats helpers used to re-read and re-parse every
 * `.jsonl` file in a session directory on every poll. A foreground task is
 * polled ~3x/second (completion wait, progress, tool stats) and every
 * background task every 10 seconds, so a 10 MB session cost ~30 MB/s of
 * synchronous main-thread I/O plus a full JSON re-parse each time.
 *
 * This module keeps per-file state (byte offset, mtime/inode, parsed lines)
 * in a module-level cache keyed by absolute file path. Each poll:
 *
 *   - stats each `.jsonl` file and reads only the bytes appended since the
 *     last poll (a positioned read, so a growing file costs one small read);
 *   - parses only the newly appended complete lines;
 *   - re-reads a file fully when it shrinks (rotation/compaction), is
 *     replaced (new inode), is rewritten at the same size (new mtime), or
 *     disappeared from the directory and reappeared;
 *   - drops cache state for files that vanished from the directory listing,
 *     so the lines a poll sees are always exactly the lines a fresh read
 *     would see.
 *
 * Malformed lines are skipped exactly as a fresh read skips them (the
 * original helpers JSON-parsed each line inside a per-line try/catch), and
 * `session_info` name resolution uses the first parseable `session_info`
 * line, the same semantics as the original whole-content scan.
 */
import { closeSync, openSync, readSync, readdirSync, readFileSync, statSync, } from "node:fs";
import { join, resolve } from "node:path";
const fileStates = new Map();
let totalCachedBytes = 0;
/** Bound on the summed size of tail-cached files; the least-recently-polled file is evicted when exceeded. */
export const MAX_CACHED_SESSION_BYTES = 256 * 1024 * 1024;
/**
 * Incremental views of all `.jsonl` files in `sessionDir`, sorted by file
 * name — the same order a fresh read iterates. Files that cannot be read
 * throw, exactly as a fresh `readFileSync` would (callers wrap in try/catch
 * or let it propagate, unchanged from the original helpers).
 */
export function readJsonlTailViews(sessionDir) {
    const dir = resolve(sessionDir);
    const names = readdirSync(dir)
        .filter((name) => name.endsWith(".jsonl"))
        .sort();
    const listed = new Set();
    const views = [];
    const now = Date.now();
    for (const name of names) {
        const filePath = join(dir, name);
        listed.add(filePath);
        const state = updateFileState(filePath, now);
        views.push({
            name,
            entries: state.entries,
            hasSessionInfo: state.hasSessionInfo,
            ...(state.firstSessionName !== undefined
                ? { firstSessionName: state.firstSessionName }
                : {}),
        });
    }
    evictUnlistedFiles(listed);
    evictToCapacity();
    return views;
}
/**
 * Whether a tail view matches the session-name filter, with the same
 * semantics as scanning the whole file content: no `session_info` line
 * means "no match" for a named query, and the FIRST parseable
 * `session_info` line decides the match.
 */
export function matchesJsonlTailViewSessionName(view, sessionName) {
    if (!sessionName)
        return true;
    if (!view.hasSessionInfo)
        return false;
    return view.firstSessionName === sessionName;
}
/** Drop all cached file state. Test hook. */
export function clearSessionTailCache() {
    fileStates.clear();
    totalCachedBytes = 0;
}
function updateFileState(filePath, now) {
    const stats = statSync(filePath);
    const state = fileStates.get(filePath);
    if (state &&
        stats.ino === state.ino &&
        stats.size >= state.size &&
        (stats.size > state.size || stats.mtimeMs === state.mtimeMs)) {
        if (stats.size > state.size) {
            appendNewBytes(state, filePath, stats);
        }
        state.lastPolledMs = now;
        return state;
    }
    // First sighting, eviction, shrink (rotation/compaction), replacement
    // (new inode), or same-size rewrite (new mtime): re-read the whole file.
    const fresh = readWholeFile(filePath, stats.mtimeMs, stats.ino);
    fresh.lastPolledMs = now;
    if (state)
        totalCachedBytes -= state.size;
    totalCachedBytes += fresh.size;
    fileStates.set(filePath, fresh);
    return fresh;
}
function readWholeFile(filePath, mtimeMs, ino) {
    const content = readFileSync(filePath, "utf-8");
    // Offsets are tracked in BYTES: a character offset would desync the next
    // positioned read the moment a line contains a non-ASCII character.
    const bytes = Buffer.byteLength(content, "utf-8");
    const state = {
        size: bytes,
        mtimeMs,
        ino,
        offset: bytes,
        partial: "",
        entries: [],
        hasSessionInfo: false,
        lastPolledMs: 0,
    };
    ingestChunk(state, content);
    return state;
}
function appendNewBytes(state, filePath, stats) {
    const length = stats.size - state.offset;
    if (length <= 0)
        return;
    // Read the appended bytes into a buffer BEFORE mutating any state, so a
    // failed read leaves the cache consistent for the next poll.
    const buffer = Buffer.alloc(length);
    let total = 0;
    const fd = openSync(filePath, "r");
    try {
        while (total < length) {
            const read = readSync(fd, buffer, total, length - total, state.offset + total);
            if (read === 0)
                break; // File shrank under us; the next poll re-reads fully.
            total += read;
        }
    }
    finally {
        closeSync(fd);
    }
    let chunk = state.partial + buffer.toString("utf-8", 0, total);
    state.offset += total;
    state.size = state.offset;
    state.mtimeMs = stats.mtimeMs;
    totalCachedBytes += total;
    if (!chunk)
        return;
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline === -1) {
        state.partial = chunk;
        return;
    }
    state.partial = chunk.slice(lastNewline + 1);
    ingestChunk(state, chunk.slice(0, lastNewline + 1));
}
/** Append complete lines from `chunk` (ending at the last newline) to the state. */
function ingestChunk(state, chunk) {
    for (const rawLine of chunk.split("\n")) {
        const line = rawLine.trim();
        if (!line)
            continue;
        let value;
        try {
            value = JSON.parse(line);
        }
        catch {
            // Skip malformed JSONL rows — same as the fresh-read helpers.
            continue;
        }
        if (typeof value !== "object" || value === null)
            continue;
        const entry = value;
        state.entries.push(entry);
        if (!state.hasSessionInfo && entry.type === "session_info") {
            state.hasSessionInfo = true;
            state.firstSessionName = entry.name ?? entry.session_info?.name;
        }
    }
}
/** Forget files that are no longer in the directory listing. */
function evictUnlistedFiles(listed) {
    for (const [filePath, state] of fileStates) {
        if (!listed.has(filePath)) {
            totalCachedBytes -= state.size;
            fileStates.delete(filePath);
        }
    }
}
function evictToCapacity() {
    while (totalCachedBytes > MAX_CACHED_SESSION_BYTES) {
        let oldestPath;
        let oldestMs = Number.POSITIVE_INFINITY;
        for (const [filePath, state] of fileStates) {
            if (state.lastPolledMs < oldestMs) {
                oldestPath = filePath;
                oldestMs = state.lastPolledMs;
            }
        }
        if (oldestPath === undefined)
            break;
        const state = fileStates.get(oldestPath);
        if (!state)
            break;
        totalCachedBytes -= state.size;
        fileStates.delete(oldestPath);
    }
}
