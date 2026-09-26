import type { UsageReceiptV1 } from "../learning-contract.js";
import { type OrchestrationReasonCode } from "./reason-codes.js";
export declare const ORCHESTRATION_EVENT_VERSION = 1;
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
export declare const ORCHESTRATION_EVENT_TYPES: readonly ["task_started", "task_resumed", "task_execution_completed", "task_completed", "task_failed", "task_cancelled", "task_timed_out", "task_outcome_reported", "task_awaiting_decision", "decision_requested", "decision_responded", "task_awaiting_review", "claim_acquired", "claim_released", "claim_lease_lost", "claim_store_quarantined", "handoff_updated", "proof_passed", "proof_failed", "review_completed", "task_reviewed", "task_shipped", "task_ship_blocked", "task_worktree_merged", "task_worktree_removed"];
export type OrchestrationEventType = (typeof ORCHESTRATION_EVENT_TYPES)[number];
/**
 * Rotate the journal once the live segment passes this size. Appending is
 * O(1) regardless, but every reader (metrics, doctor, replay, review dedup)
 * parses whatever is live, so an unbounded file degrades them all.
 */
export declare const MAX_SEGMENT_BYTES: number;
/**
 * Rotated segments are kept only while at most this many exist. The journal
 * used to rotate 4 MB segments forever: disk grew without bound and every
 * reader (replay, review dedup, metrics, doctor) parsed every segment ever
 * written. Rotation now deletes the oldest segments past this cap, and the
 * readers below only ever load live + the newest `MAX_ROTATED_SEGMENTS`
 * rotated segments.
 */
export declare const MAX_ROTATED_SEGMENTS = 10;
export interface TaskUsageSummary {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    cost: number;
    provider?: string;
    model?: string;
}
export interface NewOrchestrationEvent {
    type: OrchestrationEventType;
    orchestrationId: string;
    timestamp?: string;
    taskId?: string;
    agentType?: string;
    leaseId?: string;
    /** Lease generation token; a stale fence is refused by the write guard. */
    fence?: number;
    durationMs?: number;
    retryCount?: number;
    verificationPassed?: boolean;
    evidenceCount?: number;
    reviewFindings?: number;
    acceptedFindings?: number;
    reviewStatus?: "approved" | "changes_requested" | "rejected";
    reviewerAgent?: string;
    usage?: TaskUsageSummary;
    usageBindings?: UsageReceiptV1[];
    reason?: string;
    reasonCode?: OrchestrationReasonCode;
    verdict?: string;
    reviewerTaskId?: string;
    reviewerInvocationId?: string;
    reviewerOutputDigest?: string;
    subjectDigest?: string;
    reportedOutcome?: string;
    decisionId?: string;
    idempotencyKey?: string;
}
export interface OrchestrationEvent extends NewOrchestrationEvent {
    version: number;
    id: string;
    sequence: number;
    timestamp: string;
}
export interface OrchestrationMetrics {
    tasksStarted: number;
    tasksCompleted: number;
    tasksFailed: number;
    staleTasks: number;
    retries: number;
    totalDurationMs: number;
    averageDurationMs: number;
    totalTokens: number;
    totalCost: number;
    verificationPassRate: number | undefined;
    reviewYield: number | undefined;
    taskSuccessRate: number | undefined;
    tokensPerCompletedTask: number | undefined;
    costPerCompletedTask: number | undefined;
}
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
export declare function appendOrchestrationEvent(input: {
    eventPath: string;
    event: NewOrchestrationEvent;
}): Promise<OrchestrationEvent>;
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
export declare function readOrchestrationEvents(eventPath: string): Promise<OrchestrationEvent[]>;
export declare function summarizeTaskSessionUsage(sessionPath: string): Promise<TaskUsageSummary>;
export declare function deriveOrchestrationMetrics(input: {
    events: readonly OrchestrationEvent[];
    now?: Date;
    staleAfterMs?: number;
}): OrchestrationMetrics;
