import type { TaskReportedStatus, ToolCallRecord } from "./helpers.js";
import type { TerminalHandle, TerminalBackendKind } from "./subagent/terminalBackend.js";
import type { WorktreeHandle, WorktreeResult } from "./worktree.js";
export type { TerminalHandle, HerdrTerminalHandle } from "./subagent/terminalBackend.js";
export type ExecutionBackend = "sdk" | TerminalBackendKind;
export interface BackgroundTask {
    /** Artifact root used for session completion polling. */
    dir: string;
    /** Durable base execution directory; an isolated worktree may override it. */
    cwd?: string;
    agentType: string;
    sessionName: string;
    /** Legacy tmux field retained while old in-memory callers are migrated. */
    paneId?: string;
    handle?: TerminalHandle;
    exitSentinelPath?: string;
    backend?: ExecutionBackend;
    originalPane: string | null;
    description: string;
    startedAt: number;
    toolUses: number;
    turns: number;
    /** Effective model for this run (launch override or profile pin), if pinned. */
    model?: string;
    conversationId?: string;
    worktree?: WorktreeHandle;
    worktreeResult?: WorktreeResult;
    /** Most recent tool calls (capped), updated every COUNT_POLL_MS. */
    recentCalls: ToolCallRecord[];
    /** Consecutive completion-poll failures; reset to 0 on a successful poll. */
    pollErrors?: number;
    status?: "running" | "done" | "cancelled" | "aborted" | "failed" | "timeout";
    phase?: string;
    result?: string;
    completedAt?: number;
}
/** Serializable subset for active task registry persistence. */
export interface RegistryEntry {
    id: string;
    agentType: string;
    description: string;
    sessionName: string;
    startedAt: number;
    handle?: TerminalHandle;
    /** Legacy persisted field accepted by migration only. */
    paneId?: string;
    backend?: TerminalBackendKind;
    piDir: string;
    /** Artifact root, distinct from the child execution directory. */
    dir: string;
    /** Durable base execution directory used by the child. */
    cwd?: string;
    /** Effective model for this run, if pinned (launch override or profile pin). */
    model?: string;
    conversationId?: string;
    sessionRef?: string;
    worktree?: WorktreeHandle;
    worktreeResult?: WorktreeResult;
    /**
     * Set when a restore-time liveness check THREW (e.g. Herdr down at load)
     * instead of answering: the entry was left in the registry for the next
     * session's restore rather than silently dropped, so a still-running
     * background task cannot go unpolled without a visible trace.
     */
    restoreQuarantineReason?: string;
    restoreQuarantinedAt?: string;
}
/** Durable task→session mapping used for resume after task completion. */
export interface TaskSessionHistoryEntry extends RegistryEntry {
    status: "running" | "done" | "cancelled" | "aborted" | "failed" | "timeout";
    reportedStatus?: TaskReportedStatus;
    resultValid?: boolean;
    completedAt?: number;
    background: boolean;
}
