/**
 * Read assistant text from pi JSONL session directories used by task sessions.
 *
 * All reads go through the incremental tail cache (session-tail-cache.ts):
 * only bytes appended since the last poll are read and parsed, so the 1s
 * completion/progress polls and the 3s/10s stats polls no longer pay a full
 * re-read + full re-parse of every session file on every tick.
 */
/**
 * Whether the subagent has finished producing responses.
 *
 * The reliable completion signal is the last assistant message's stopReason.
 * - "toolUse": the agent called tools and should continue, so it is not done.
 * - "stop" / "endTurn" / "length" / "error" / "aborted": terminal.
 * - no assistant messages or no stopReason yet: not done.
 */
export declare function getAgentTerminalStopReason(sessionDir: string, sessionName?: string, sinceMs?: number): string | undefined;
export declare function hasAgentFinished(sessionDir: string, sessionName?: string, sinceMs?: number): boolean;
/**
 * Last non-empty assistant message from matching .jsonl files in sessionDir.
 */
export declare function getLastAssistantTextFromSessionDir(sessionDir: string, sessionName?: string, sinceMs?: number): string;
