import { type DurableTaskRun } from "./run-store.js";
import type { OrchestrationEvent } from "./telemetry.js";
export type ReviewerVerdict = "approved" | "changes_requested" | "rejected";
export interface ReviewerOwnedVerdict {
    verdict: ReviewerVerdict;
    reviewedDigest: string;
    outputDigest: string;
}
export interface SemanticAttestationInput {
    claim: string;
    receiptId: string;
    artifactDigest: string;
    subjectDigest: string;
}
/**
 * Parse the verdict from the reviewer's canonical final assistant output.
 *
 * The caller supplies no verdict. The reviewer must name the exact subject
 * digest it reviewed, which prevents a completed review from being rebound to
 * a later mutation of the producer's session, evidence, or retained worktree.
 */
export declare function parseReviewerOwnedVerdict(output: string, expectedSubjectDigest: string): ReviewerOwnedVerdict;
export declare function parseSemanticAttestations(output: string, requiredClaims: readonly string[], expectedSubjectDigest: string): SemanticAttestationInput[];
export declare function isAcceptingReviewerVerdict(verdict: string | undefined): boolean;
/**
 * Digest the canonical reviewer subject. The session, retained worktree diff,
 * and durable evidence references are all bound so a verdict cannot be reused
 * after any of those inputs changes.
 */
export declare function taskSubjectDigest(projectDirectory: string, taskId: string): Promise<string>;
/**
 * Re-prove a durable review event from the canonical reviewer run and final
 * output. Presence of reviewer-shaped fields in the writable event journal is
 * not authority by itself.
 */
export declare function isReviewerEventBound(input: {
    event: OrchestrationEvent;
    subject: DurableTaskRun;
    subjectDigest: string;
    projectDirectory: string;
    runs: readonly DurableTaskRun[];
}): Promise<boolean>;
