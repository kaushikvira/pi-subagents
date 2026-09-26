/**
 * @version 1 — Bounded learning integration events for auto-safe/pi-learning.
 *
 * These types carry no raw transcripts, secret payloads, or full agent output.
 * They are designed for optional consumption by a parent coordinator (e.g.
 * pi-harness learning coordinator) that writes the durable learning ledger.
 *
 * ── Design rules ──────────────────────────────────────────────────────────
 * 1. Every exported type is versioned (V1 suffix).
 * 2. String fields are length-capped by the validation/clamping helper.
 * 3. No field carries raw agent output, session transcripts, or secrets.
 * 4. Event emission is fail-open: a missing or throwing listener never
 *    blocks the task lifecycle.
 * 5. Context responses use the correlated, bounded pi-learning v2 event;
 *    the request payload is immutable.
 * ───────────────────────────────────────────────────────────────────────────
 */
import type { ContextFact } from "./orchestration/context.js";
import { type SupportedLearningClaimV1, type TaggedSha256V1, type UsageReceiptV1 } from "./learning-contract.js";
export { makeLearningClaim, makeLearningClaimIntent, parseLearningClaims, parseSupportedLearningClaims, parseUsageReceipts, taggedDigest, type LearningClaim, type LearningClaimIntentV2, type LearningClaimV1, type SupportedLearningClaimV1, type TaggedSha256V1, type UsageReceiptV1, } from "./learning-contract.js";
export { makeTaskSettledEvent, makeTaskStartedEvent, parseTaskSettledEvent, parseTaskStartedEvent, TASK_LIFECYCLE_EVENTS_V1, type ReportedTaskOutcomeV1, type TaskExecutionPhaseV1, type TaskSettledEventV1, type TaskStartedEventV1, type TerminalTaskOutcomeV1, } from "@minhduydev/pi-core/task-lifecycle";
export interface LearningFactV1 {
    /** Domain or category this fact belongs to (e.g. "typescript", "testing"). */
    domain: string;
    /** Short natural-language summary of the fact. */
    summary: string;
    /** How reliable the source considers this fact. */
    confidence: "high" | "medium" | "low";
    /** Optional hex-encoded SHA-256 digest of the evidence backing this fact. */
    evidenceDigest?: string;
}
export { contextRequestPreimage, contextRequestPreimageV2, makeContextRequestPayload, makeContextRequestPayloadV2, parseContextRequest, parseContextRequestV2, withContextRequestBinding, type ContextRequestPayloadV1, type ContextRequestPayloadV2, type LearningConfidenceV1, } from "@minhduydev/pi-core";
export interface LearningPatternV1 {
    /** Category label (e.g. "error-pattern", "workflow"). */
    category: string;
    /** Short description of the pattern. */
    description: string;
}
export interface LearningMetricsV1 {
    totalTasksCompleted?: number;
    totalProofsPassed?: number;
    totalProofsFailed?: number;
}
/**
 * Bounded learning context payload.
 * - `facts` is required (at least 1 entry after validation).
 * - `patterns` and `metrics` are optional.
 * - No field carries raw transcripts or secrets.
 * - All string fields are length-capped by `validateLearningContext`.
 */
export interface LearningContextV1 {
    version: 1;
    facts: LearningFactV1[];
    patterns?: LearningPatternV1[];
    metrics?: LearningMetricsV1;
    usageReceipts?: UsageReceiptV1[];
}
export declare const SUBAGENT_LEARNING_EVENTS_V1: {
    /**
     * Emitted before a task is launched to request optional learning context.
     * Listeners answer on `pi-learning:v2:context-served`.
     */
    readonly CONTEXT_REQUEST: "pi-subagents:v1:context-request";
    /**
     * Emitted after proof verification is durably recorded.
     * Carries verification outcome, issues, and evidence digests.
     */
    readonly PROOF_VERIFIED: "pi-subagents:v1:proof-verified";
    /**
     * Emitted after a review verdict is durably recorded.
     * Carries verdict, reviewer identity, and subject digest.
     */
    readonly REVIEW_COMPLETED: "pi-subagents:v1:review-completed";
};
export declare const SUBAGENT_LEARNING_EVENTS_V2: {
    readonly CONTEXT_REQUEST: "pi-subagents:v2:context-request";
};
/**
 * Payload for `pi-subagents:proof-verified`.
 *
 * Emitted only after the durable run store and orchestration event log
 * have been updated. Proof pass and fail are distinct events (same type,
 * different `verificationPassed` value).
 */
export interface ProofVerifiedPayloadV1 {
    protocolVersion: 1;
    taskId: string;
    /** Stable orchestration correlation shared with context and review events. */
    correlationId: string;
    /** Canonical digest of the context request this proof answers. */
    requestDigest: TaggedSha256V1;
    projectId?: string;
    trustEpoch?: string;
    sessionGeneration?: string;
    /** Per-claim support results bound to named evidence. */
    supportedClaims: readonly SupportedLearningClaimV1[];
    /** true = proof passed, false = proof failed. */
    verificationPassed: boolean;
    /** Human-readable issues from proof validation (empty on pass).
     *  Each issue is clamped to 500 chars, no raw transcripts. */
    verificationIssues: readonly string[];
    /** Evidence receipt digests (SHA-256 hex) that were evaluated. */
    evidenceDigests: readonly string[];
    /** ISO-8601 timestamp of when the verification was recorded. */
    timestamp: string;
}
/** Maximum length for taskId in events. */
export declare const MAX_TASK_ID = 128;
/** Maximum length for agentType in events. */
export declare const MAX_AGENT_TYPE = 64;
/** Maximum length for description in events. */
export declare const MAX_DESCRIPTION = 300;
/** Maximum length for review verdict in events. */
export declare const MAX_VERDICT = 256;
/** Maximum length for reviewer/invocation IDs in events. */
export declare const MAX_ID = 128;
/** Maximum length for a single issue string. */
export declare const MAX_ISSUE_LENGTH = 500;
/** Maximum number of issues in a proof event. */
export declare const MAX_ISSUES = 20;
/** Maximum number of evidence digests in a proof event. */
export declare const MAX_EVIDENCE_DIGESTS = 50;
export declare function clampString(value: string, maxLength: number): string;
/**
 * Clamp an array of issue strings, each clamped to MAX_ISSUE_LENGTH.
 * The array itself is bounded to MAX_ISSUES items.
 */
export declare function clampIssues(issues: readonly string[]): readonly string[];
/**
 * Validate that a string is a valid hex-encoded SHA-256 digest.
 * Returns the digest if valid, undefined otherwise.
 */
export declare function validateSha256Hex(value: string): string | undefined;
/**
 * Validate an array of evidence digest strings.
 * Returns only valid SHA-256 hex digests, bounded to MAX_EVIDENCE_DIGESTS items.
 */
export declare function validateEvidenceDigests(digests: readonly string[]): readonly string[];
/**
 * Construct a bounded `ProofVerifiedPayloadV1`.
 * - Issues are clamped and bounded.
 * - Evidence digests are validated as SHA-256 hex and bounded.
 * - taskId is clamped.
 */
export declare function makeProofVerifiedPayload(taskId: string, verificationPassed: boolean, issues: readonly string[], evidenceDigests: readonly string[], correlationId?: string, details?: {
    requestDigest: string;
    projectId?: string;
    trustEpoch?: string;
    sessionGeneration?: string;
    supportedClaims: readonly unknown[];
}): ProofVerifiedPayloadV1;
/**
 * Construct a bounded `ReviewCompletedPayloadV1`.
 * - verdict is clamped.
 * - reviewerTaskId and reviewerInvocationId are clamped.
 * - subjectDigest is validated as SHA-256 hex (or empty string if invalid).
 */
export declare function makeReviewCompletedPayload(taskId: string, verdict: string, reviewerTaskId: string, reviewerInvocationId: string, subjectDigest: string, correlationId?: string): ReviewCompletedPayloadV1;
/**
 * Payload for `pi-subagents:review-completed`.
 *
 * Emitted only after the review verdict is durably appended to the
 * orchestration event log. The verdict may be "accepted" or "rejected".
 */
export interface ReviewCompletedPayloadV1 {
    protocolVersion: 1;
    taskId: string;
    /** Stable orchestration correlation shared with context and proof events. */
    correlationId: string;
    /** The review verdict text. */
    verdict: string;
    /** Task ID of the reviewer subagent. */
    reviewerTaskId: string;
    /** Invocation ID of the reviewer subagent. */
    reviewerInvocationId: string;
    /** Hex-encoded SHA-256 digest of the subject task output. */
    subjectDigest: string;
    /** ISO-8601 timestamp of when the review was recorded. */
    timestamp: string;
}
/**
 * Validate and clamp an unknown value to a safe `LearningContextV1`.
 *
 * Rules:
 * - At most 3 facts are kept (excess silently dropped).
 * - Each fact domain/summary is length-capped.
 * - Only known confidence values are accepted.
 * - Patterns and metrics are optional and clamped.
 * - Returns `undefined` when the input is unusable (no valid facts).
 */
export declare function validateLearningContext(input: unknown): LearningContextV1 | undefined;
/**
 * Merge a validated `LearningContextV1` into a context pack's knownFacts
 * array, labelled as provenance "learning". The merge is additive only:
 * it never overrides existing facts.
 *
 * Each learning fact is converted to a `ContextFact` with:
 * - `statement`: `[learning] <domain>: <summary>`
 * - `source`: `"learning"` (explicitly non-authoritative)
 * - `reference`: `"pi-learning:<evidenceDigest-or-active>"`
 *
 * @param knownFacts - The existing knownFacts array (may be undefined).
 * @param learningCtx - A validated learning context.
 * @param maxTotalChars - Maximum total characters for all newly added
 *   learning statements (default 1200). Existing facts are preserved;
 *   only new learning statements count toward this budget. Facts whose
 *   statement would exceed the budget are silently dropped.
 * @returns A new array with learning facts appended (or the original if
 *   learningCtx is undefined).
 */
export declare function mergeLearningFacts(knownFacts: readonly ContextFact[] | undefined, learningCtx: LearningContextV1 | undefined, maxTotalChars?: number): readonly ContextFact[];
