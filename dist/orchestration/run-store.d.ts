import type { ResourceClaim, ResourceLease } from "./claims.js";
import type { TaggedSha256V1, UsageReceiptV1 } from "../learning-contract.js";
import { type OrchestrationReasonCode } from "./reason-codes.js";
import type { ContextPack } from "./context.js";
import type { OrchestrationRequest } from "./contract.js";
import type { WorktreeHandle, WorktreeResult } from "../worktree.js";
/**
 * Retention for TERMINAL runs in the run store. The store used to grow
 * without bound: every heartbeat, launch event, and pending-completion
 * retry paid a lock + full read + full rewrite of `runs.json`, so the cost
 * was O(all tasks ever) on a hot path. Terminal runs older than this window
 * are pruned (lazily, on write, when the store exceeds the cap below).
 */
export declare const RUN_STORE_RETENTION_MS: number;
/** Hard cap on stored runs; oldest prunable terminal runs shed beyond it. */
export declare const RUN_STORE_MAX_RUNS = 1000;
export type TaskExecutionPhase = "allocating" | "starting" | "working" | "blocked" | "completed" | "failed" | "cancelled" | "timeout";
export type TaskVerificationPhase = "not-required" | "pending"
/** Runtime receipt integrity passed; semantic claims require independent review. */
 | "receipt-passed" | "passed" | "failed";
export type TaskReviewPhase = "not-required" | "awaiting" | "accepted" | "rejected";
/**
 * The outcome reported by the child is deliberately independent from the
 * process/execution phase.  A process may exit cleanly while reporting that it
 * is blocked, partial, or waiting for a decision.  Advancement gates must use
 * this axis rather than inferring success from `executionPhase === completed`.
 */
export type TaskReportedOutcome = "unknown" | "success" | "failure" | "blocked" | "partial" | "reframed" | "awaiting-decision";
export interface DurableDecisionOption {
    id: string;
    label: string;
    tradeoff?: string;
}
export interface DurableDecisionResponse {
    optionId?: string;
    response: string;
    respondedAt: string;
    responseDigest: TaggedSha256V1;
    /** Stable correlation used to find a resume that started before a crash. */
    resumeCorrelationId?: string;
    /**
     * Durable outbox state for the non-transactional task-launch boundary.
     * Missing means a response written by an older build and is retriable.
     */
    resumeState?: "dispatching" | "started" | "failed";
    resumeAttemptId?: string;
    /** Runtime instance currently owning this dispatch attempt. */
    resumeDispatcherId?: string;
    resumeDispatchStartedAt?: string;
    resumeError?: string;
    resumedInvocationId?: string;
}
export interface DurableDecisionRequest {
    id: string;
    question: string;
    options: DurableDecisionOption[];
    context?: string;
    requestedAt: string;
    requestDigest: TaggedSha256V1;
    status: "pending" | "resolved";
    response?: DurableDecisionResponse;
}
export interface SemanticAttestationV1 {
    claim: string;
    claimId?: TaggedSha256V1;
    receiptId: string;
    artifactDigest: string;
    reviewerTaskId: string;
    reviewerInvocationId: string;
    reviewerOutputDigest: string;
    subjectDigest: string;
    attestedAt: string;
}
export interface DurableTaskRun {
    version: 1;
    invocationId: string;
    correlationId?: string;
    contextRequestDigest?: TaggedSha256V1;
    learningBinding?: {
        projectId: string;
        trustEpoch: string;
        sessionGeneration: string;
    };
    usageBindings?: UsageReceiptV1[];
    taskId?: string;
    batchId?: string;
    joinMode?: "async" | "group";
    agentType?: string;
    description?: string;
    /** Parent/control root that owns durable orchestration state. */
    projectDirectory: string;
    /** Base repository/directory in which claims and context paths are interpreted. */
    workspaceDirectory: string;
    /** Actual child cwd; differs from workspaceDirectory when worktree-isolated. */
    executionDirectory: string;
    worktree?: WorktreeHandle;
    worktreeResult?: WorktreeResult;
    worktreeDisposition?: "retained" | "merged" | "removed";
    mergeCommitSha?: string;
    startedAt: string;
    updatedAt: string;
    heartbeatAt: string;
    executionPhase: TaskExecutionPhase;
    reportedOutcome: TaskReportedOutcome;
    /** Why the run is `blocked` — e.g. it lost its resource lease. */
    blockedReason?: string;
    blockedReasonCode?: OrchestrationReasonCode;
    verificationPhase: TaskVerificationPhase;
    reviewPhase: TaskReviewPhase;
    verificationIssues: string[];
    claims: ResourceClaim[];
    lease?: ResourceLease;
    leaseTtlMs?: number;
    contextPack?: ContextPack;
    proof?: OrchestrationRequest["proof"];
    /** Immutable, reviewer-owned semantic attestations. */
    semanticAttestations?: SemanticAttestationV1[];
    verifier?: OrchestrationRequest["verifier"];
    sessionReference?: string;
    resultDigest?: TaggedSha256V1;
    decisionRequest?: DurableDecisionRequest;
}
export interface CreateDurableRunInput {
    invocationId?: string;
    correlationId?: string;
    contextRequestDigest?: TaggedSha256V1;
    learningBinding?: {
        projectId: string;
        trustEpoch: string;
        sessionGeneration: string;
    };
    usageBindings?: UsageReceiptV1[];
    batchId?: string;
    joinMode?: "async" | "group";
    agentType?: string;
    description?: string;
    projectDirectory: string;
    workspaceDirectory?: string;
    executionDirectory?: string;
    startedAt?: string;
    claims?: readonly ResourceClaim[];
    lease?: ResourceLease;
    leaseTtlMs?: number;
    contextPack?: ContextPack;
    proof?: OrchestrationRequest["proof"];
    verifier?: OrchestrationRequest["verifier"];
}
export declare function createDurableRun(input: CreateDurableRunInput): DurableTaskRun;
export declare function putDurableRun(storePath: string, run: DurableTaskRun): Promise<DurableTaskRun>;
/**
 * Atomically claim a run's terminal result. Replaying the exact digest is
 * idempotent; a competing terminal observation with different bytes fails.
 */
export declare function completeDurableRun(storePath: string, invocationId: string, resultDigest: TaggedSha256V1, patch: Partial<DurableTaskRun> & {
    executionPhase: TaskExecutionPhase;
}): Promise<DurableTaskRun | undefined>;
export declare function patchDurableRun(storePath: string, invocationId: string, patch: Partial<DurableTaskRun> | ((current: DurableTaskRun) => Partial<DurableTaskRun>)): Promise<DurableTaskRun | undefined>;
export declare function getDurableRunByTaskId(storePath: string, taskId: string): Promise<DurableTaskRun | undefined>;
/** Find the attempt that owns a durable decision, even after a later resume. */
export declare function getDurableRunByDecisionId(storePath: string, taskId: string, decisionId: string): Promise<DurableTaskRun | undefined>;
export declare function getDurableRunByInvocationId(storePath: string, invocationId: string): Promise<DurableTaskRun | undefined>;
export declare function listDurableRuns(storePath: string): Promise<DurableTaskRun[]>;
export declare function canTransitionExecution(current: TaskExecutionPhase, next: TaskExecutionPhase): boolean;
export declare function isTerminalExecutionPhase(phase: TaskExecutionPhase): boolean;
/** Reporter for a run store that had to be quarantined; wired by the runtime. */
export type RunStoreQuarantineReporter = (info: {
    storePath: string;
    quarantinePath: string;
    reason: string;
}) => void;
export declare function setRunStoreQuarantineReporter(reporter: RunStoreQuarantineReporter): void;
