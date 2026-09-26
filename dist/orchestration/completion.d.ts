import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ResourceLease } from "./claims.js";
import type { ContextPack } from "./context.js";
import { type OrchestrationPaths } from "./paths.js";
import { type EvidenceProofResult } from "./proof.js";
import { type TaskReportedOutcome } from "./run-store.js";
import type { OrchestrationRequest } from "./contract.js";
export interface ActiveRun {
    invocationId?: string;
    orchestrationId: string;
    taskId: string;
    agentType?: string;
    startedAt: string;
    lease?: ResourceLease;
    leaseTtlMs?: number;
    lastHeartbeatAt?: number;
    /**
     * Monotonic timestamp of the last successful lease renewal, used to detect
     * that the process was suspended long enough for the lease to lapse. The wall
     * clock cannot tell a 30-minute sleep from a 30-minute pause.
     */
    lastRenewMonotonicMs?: number;
    /** Set when the run lost its lease; the write guard refuses it from then on. */
    leaseLost?: boolean;
    /** Prevent overlapping interval callbacks from racing lease transfer/renewal. */
    heartbeatInFlight?: boolean;
    contextPack?: ContextPack;
    proof?: OrchestrationRequest["proof"];
    verifier?: OrchestrationRequest["verifier"];
    projectDirectory: string;
    workspaceDirectory?: string;
    executionDirectory?: string;
    batchId?: string;
    joinMode?: "async" | "group";
    reportedOutcome?: TaskReportedOutcome;
    semanticAttestations?: import("./run-store.js").SemanticAttestationV1[];
}
export interface BackgroundCompletionResult {
    handled: boolean;
    taskId?: string;
    executionPhase?: "completed" | "failed" | "cancelled" | "timeout";
    reportedOutcome?: TaskReportedOutcome;
    decisionRequest?: Record<string, unknown>;
    decisionId?: string;
    proof?: EvidenceProofResult;
    awaitingReview?: boolean;
    issues: string[];
}
export declare function recordForegroundCompletion(run: ActiveRun, paths: OrchestrationPaths, upstreamResult?: {
    details?: unknown;
    isError?: boolean;
}, pi?: ExtensionAPI): Promise<EvidenceProofResult | undefined>;
export declare function recordBackgroundCompletion(pi: ExtensionAPI, activeRuns: Map<string, ActiveRun>, message: Record<string, unknown>): Promise<BackgroundCompletionResult>;
export declare function releaseLeaseAndRecord(paths: OrchestrationPaths, orchestrationId: string, lease: ResourceLease): Promise<void>;
