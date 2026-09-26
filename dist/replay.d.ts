import { type TaggedSha256V1 } from "./learning-contract.js";
import { type DurableTaskRun } from "./orchestration/run-store.js";
import { ORCHESTRATION_EVENT_VERSION, readOrchestrationEvents, type OrchestrationEvent, type OrchestrationEventType } from "./orchestration/telemetry.js";
export { ORCHESTRATION_EVENT_VERSION, readOrchestrationEvents, type OrchestrationEvent, type OrchestrationEventType, };
export interface OrchestrationReplayCursorV1 {
    version: 1;
    producer: "pi-subagents";
    streamId: "orchestration-events";
    streamGeneration: TaggedSha256V1;
    sequence: number;
    eventId: string;
    prefixHash: TaggedSha256V1;
    payloadDigest: TaggedSha256V1;
}
export interface OrchestrationReplayPort {
    replay(after?: OrchestrationReplayCursorV1, limit?: number): Promise<{
        events: OrchestrationEvent[];
        next?: OrchestrationReplayCursorV1;
    }>;
}
export interface TaskProvenanceEntryV1 {
    version: 1;
    producer: "pi-subagents";
    taskId?: string;
    invocationId: string;
    agentType?: string;
    description?: string;
    executionPhase: DurableTaskRun["executionPhase"];
    reportedOutcome: DurableTaskRun["reportedOutcome"];
    verificationPhase: DurableTaskRun["verificationPhase"];
    reviewPhase: DurableTaskRun["reviewPhase"];
    startedAt: string;
    updatedAt: string;
    resultDigest?: TaggedSha256V1;
}
export interface TaskProvenanceQuery {
    projectDirectory: string;
    limit?: number;
}
/**
 * Returns a deliberately small, path-free view of durable task history for
 * recall consumers. Transcript references, claims, proof payloads, worktree
 * paths, and verification issue text stay behind the orchestration boundary.
 */
export declare function listTaskProvenance(query: TaskProvenanceQuery): Promise<TaskProvenanceEntryV1[]>;
export declare function createOrchestrationReplayPort(input: {
    projectDirectory: string;
}): OrchestrationReplayPort;
