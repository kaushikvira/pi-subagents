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
/** One parsed JSONL line. Fields consumers read are optional, like the fresh reads. */
export type SessionJsonlEntry = {
    type?: string;
    name?: string;
    session_info?: {
        name?: string;
    };
    timestamp?: string;
    message?: Record<string, unknown>;
};
/** Incremental view of one `.jsonl` file, in file order. */
export interface JsonlTailView {
    /** File name inside the session dir (e.g. "session-name.jsonl"). */
    name: string;
    /** Parsed complete lines in file order; malformed lines are skipped. */
    entries: readonly SessionJsonlEntry[];
    /** Whether a parseable `session_info` line has been seen so far. */
    hasSessionInfo: boolean;
    /** Name from the first parseable `session_info` line (`name ?? session_info.name`). */
    firstSessionName?: string;
}
/** Bound on the summed size of tail-cached files; the least-recently-polled file is evicted when exceeded. */
export declare const MAX_CACHED_SESSION_BYTES: number;
/**
 * Incremental views of all `.jsonl` files in `sessionDir`, sorted by file
 * name — the same order a fresh read iterates. Files that cannot be read
 * throw, exactly as a fresh `readFileSync` would (callers wrap in try/catch
 * or let it propagate, unchanged from the original helpers).
 */
export declare function readJsonlTailViews(sessionDir: string): JsonlTailView[];
/**
 * Whether a tail view matches the session-name filter, with the same
 * semantics as scanning the whole file content: no `session_info` line
 * means "no match" for a named query, and the FIRST parseable
 * `session_info` line decides the match.
 */
export declare function matchesJsonlTailViewSessionName(view: Pick<JsonlTailView, "hasSessionInfo" | "firstSessionName">, sessionName?: string): boolean;
/** Drop all cached file state. Test hook. */
export declare function clearSessionTailCache(): void;
