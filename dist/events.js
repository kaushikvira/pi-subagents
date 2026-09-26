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
import { redactSensitiveText } from "./orchestration/context.js";
import { PI_EVENTS_V2 } from "@minhduydev/pi-core";
import { parseSupportedLearningClaims, parseUsageReceipts, taggedDigest, } from "./learning-contract.js";
export { makeLearningClaim, makeLearningClaimIntent, parseLearningClaims, parseSupportedLearningClaims, parseUsageReceipts, taggedDigest, } from "./learning-contract.js";
export { makeTaskSettledEvent, makeTaskStartedEvent, parseTaskSettledEvent, parseTaskStartedEvent, TASK_LIFECYCLE_EVENTS_V1, } from "@minhduydev/pi-core/task-lifecycle";
// The context-request payload and its constructor come from pi-core: the
// producer's digest preimage and the consumers' expectations are the same
// function there, and `confidence` is emitted at the source with a default —
// two packages no longer need a third to bridge them (audit §2.2, §2.3).
export { contextRequestPreimage, contextRequestPreimageV2, makeContextRequestPayload, makeContextRequestPayloadV2, parseContextRequest, parseContextRequestV2, withContextRequestBinding, } from "@minhduydev/pi-core";
// ───────────────────────────────────────────────────────────────────────────
//  Event name constants
// ───────────────────────────────────────────────────────────────────────────
export const SUBAGENT_LEARNING_EVENTS_V1 = {
    /**
     * Emitted before a task is launched to request optional learning context.
     * Listeners answer on `pi-learning:v2:context-served`.
     */
    CONTEXT_REQUEST: "pi-subagents:v1:context-request",
    /**
     * Emitted after proof verification is durably recorded.
     * Carries verification outcome, issues, and evidence digests.
     */
    PROOF_VERIFIED: "pi-subagents:v1:proof-verified",
    /**
     * Emitted after a review verdict is durably recorded.
     * Carries verdict, reviewer identity, and subject digest.
     */
    REVIEW_COMPLETED: "pi-subagents:v1:review-completed",
};
export const SUBAGENT_LEARNING_EVENTS_V2 = {
    CONTEXT_REQUEST: PI_EVENTS_V2.SUBAGENT_CONTEXT_REQUEST,
};
/** Maximum length for taskId in events. */
export const MAX_TASK_ID = 128;
/** Maximum length for agentType in events. */
export const MAX_AGENT_TYPE = 64;
/** Maximum length for description in events. */
export const MAX_DESCRIPTION = 300;
/** Maximum length for review verdict in events. */
export const MAX_VERDICT = 256;
/** Maximum length for reviewer/invocation IDs in events. */
export const MAX_ID = 128;
/** Maximum length for a single issue string. */
export const MAX_ISSUE_LENGTH = 500;
/** Maximum number of issues in a proof event. */
export const MAX_ISSUES = 20;
/** Maximum number of evidence digests in a proof event. */
export const MAX_EVIDENCE_DIGESTS = 50;
/** Hex-encoded SHA-256 digest length. */
const SHA256_HEX_LENGTH = 64;
/**
 * Clamp a string to a maximum length, redacting any content beyond the limit.
 * Returns the clamped string. If the string contains potential secrets
 * (e.g. long base64-like sequences), it is fully redacted.
 */
function safeRedact(value) {
    if (typeof value !== "string")
        return "";
    try {
        return redactSensitiveText(value);
    }
    catch {
        return "";
    }
}
export function clampString(value, maxLength) {
    if (!Number.isSafeInteger(maxLength) || maxLength < 0) {
        throw new RangeError("maxLength must be a non-negative safe integer");
    }
    if (typeof value !== "string")
        return "";
    // Redact if it looks like a long base64/hex token (no spaces, mostly alphanumeric)
    if (value.length > 100 && /^[A-Za-z0-9+/=_\-]{100,}$/.test(value.slice(0, 200))) {
        return `[redacted:${value.length}chars]`.slice(0, maxLength);
    }
    return safeRedact(value.normalize("NFKC")).slice(0, maxLength);
}
/**
 * Clamp an array of issue strings, each clamped to MAX_ISSUE_LENGTH.
 * The array itself is bounded to MAX_ISSUES items.
 */
export function clampIssues(issues) {
    if (!Array.isArray(issues))
        return [];
    return issues
        .slice(0, MAX_ISSUES)
        .map((issue) => clampString(safeRedact(issue), MAX_ISSUE_LENGTH));
}
/**
 * Validate that a string is a valid hex-encoded SHA-256 digest.
 * Returns the digest if valid, undefined otherwise.
 */
export function validateSha256Hex(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    if (trimmed.length !== SHA256_HEX_LENGTH)
        return undefined;
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed))
        return undefined;
    return trimmed;
}
/**
 * Validate an array of evidence digest strings.
 * Returns only valid SHA-256 hex digests, bounded to MAX_EVIDENCE_DIGESTS items.
 */
export function validateEvidenceDigests(digests) {
    if (!Array.isArray(digests))
        return [];
    return digests
        .slice(0, MAX_EVIDENCE_DIGESTS)
        .map((d) => validateSha256Hex(d))
        .filter((d) => d !== undefined);
}
// ───────────────────────────────────────────────────────────────────────────
//  Bounded constructors (single validation path for emission boundaries)
// ───────────────────────────────────────────────────────────────────────────
/**
 * Construct a bounded `ProofVerifiedPayloadV1`.
 * - Issues are clamped and bounded.
 * - Evidence digests are validated as SHA-256 hex and bounded.
 * - taskId is clamped.
 */
export function makeProofVerifiedPayload(taskId, verificationPassed, issues, evidenceDigests, correlationId = taskId, details) {
    const boundedTaskId = clampString(taskId, MAX_TASK_ID);
    const boundedCorrelationId = clampString(correlationId, MAX_ID);
    const requestDigest = details?.requestDigest;
    if (requestDigest !== undefined && !/^sha256:v1:[a-f0-9]{64}$/.test(requestDigest)) {
        throw new Error("requestDigest must be a tagged SHA-256 digest");
    }
    return {
        protocolVersion: 1,
        taskId: boundedTaskId,
        correlationId: boundedCorrelationId,
        requestDigest: requestDigest
            ?? taggedDigest({ taskId: boundedTaskId, correlationId: boundedCorrelationId }),
        ...(details?.projectId ? { projectId: clampString(details.projectId, MAX_ID) } : {}),
        ...(details?.trustEpoch ? { trustEpoch: clampString(details.trustEpoch, MAX_ID) } : {}),
        ...(details?.sessionGeneration
            ? { sessionGeneration: clampString(details.sessionGeneration, MAX_ID) }
            : {}),
        supportedClaims: parseSupportedLearningClaims(details?.supportedClaims),
        verificationPassed,
        verificationIssues: clampIssues(issues),
        evidenceDigests: validateEvidenceDigests(evidenceDigests),
        timestamp: new Date().toISOString(),
    };
}
/**
 * Construct a bounded `ReviewCompletedPayloadV1`.
 * - verdict is clamped.
 * - reviewerTaskId and reviewerInvocationId are clamped.
 * - subjectDigest is validated as SHA-256 hex (or empty string if invalid).
 */
export function makeReviewCompletedPayload(taskId, verdict, reviewerTaskId, reviewerInvocationId, subjectDigest, correlationId = taskId) {
    return {
        protocolVersion: 1,
        taskId: clampString(taskId, MAX_TASK_ID),
        correlationId: clampString(correlationId, MAX_ID),
        verdict: clampString(safeRedact(verdict), MAX_VERDICT),
        reviewerTaskId: clampString(reviewerTaskId, MAX_ID),
        reviewerInvocationId: clampString(reviewerInvocationId, MAX_ID),
        subjectDigest: validateSha256Hex(subjectDigest) ?? "",
        timestamp: new Date().toISOString(),
    };
}
// ───────────────────────────────────────────────────────────────────────────
//  Validation / clamping helpers
// ───────────────────────────────────────────────────────────────────────────
const MAX_FACTS = 3;
const MAX_FACT_DOMAIN_LENGTH = 200;
const MAX_FACT_SUMMARY_LENGTH = 1200;
const MAX_PATTERNS = 10;
const MAX_PATTERN_CATEGORY_LENGTH = 100;
const MAX_PATTERN_DESCRIPTION_LENGTH = 500;
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
export function validateLearningContext(input) {
    if (!input || typeof input !== "object")
        return undefined;
    const ctx = input;
    if (ctx.version !== 1)
        return undefined;
    if (!Array.isArray(ctx.facts))
        return undefined;
    const facts = [];
    for (const fact of ctx.facts.slice(0, MAX_FACTS)) {
        if (!fact || typeof fact !== "object")
            continue;
        const f = fact;
        if (typeof f.domain !== "string" || f.domain.length === 0)
            continue;
        if (typeof f.summary !== "string" || f.summary.length === 0)
            continue;
        const confidence = f.confidence;
        if (confidence !== "high" && confidence !== "medium" && confidence !== "low")
            continue;
        const evidenceDigest = f.evidenceDigest === undefined
            ? undefined
            : typeof f.evidenceDigest === "string"
                ? validateSha256Hex(f.evidenceDigest)
                : undefined;
        if (f.evidenceDigest !== undefined && evidenceDigest === undefined)
            continue;
        facts.push({
            domain: String(f.domain).slice(0, MAX_FACT_DOMAIN_LENGTH),
            summary: String(f.summary).slice(0, MAX_FACT_SUMMARY_LENGTH),
            confidence: confidence,
            ...(evidenceDigest !== undefined ? { evidenceDigest } : {}),
        });
    }
    if (facts.length === 0)
        return undefined;
    const result = { version: 1, facts };
    if (Array.isArray(ctx.patterns)) {
        result.patterns = ctx.patterns
            .slice(0, MAX_PATTERNS)
            .filter((p) => typeof p === "object" && p !== null)
            .map((p) => ({
            category: String(p.category ?? "").slice(0, MAX_PATTERN_CATEGORY_LENGTH),
            description: String(p.description ?? "").slice(0, MAX_PATTERN_DESCRIPTION_LENGTH),
        }))
            .filter((p) => p.category.length > 0);
    }
    if (ctx.usageReceipts !== undefined) {
        try {
            result.usageReceipts = parseUsageReceipts(ctx.usageReceipts);
        }
        catch {
            return undefined;
        }
    }
    if (ctx.metrics && typeof ctx.metrics === "object") {
        const m = ctx.metrics;
        const metrics = {};
        if (typeof m.totalTasksCompleted === "number" && Number.isFinite(m.totalTasksCompleted))
            metrics.totalTasksCompleted = Math.max(0, Math.floor(m.totalTasksCompleted));
        if (typeof m.totalProofsPassed === "number" && Number.isFinite(m.totalProofsPassed))
            metrics.totalProofsPassed = Math.max(0, Math.floor(m.totalProofsPassed));
        if (typeof m.totalProofsFailed === "number" && Number.isFinite(m.totalProofsFailed))
            metrics.totalProofsFailed = Math.max(0, Math.floor(m.totalProofsFailed));
        if (Object.keys(metrics).length > 0)
            result.metrics = metrics;
    }
    return result;
}
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
export function mergeLearningFacts(knownFacts, learningCtx, maxTotalChars = 1200) {
    if (!learningCtx || learningCtx.facts.length === 0) {
        return knownFacts ?? [];
    }
    const base = knownFacts ? [...knownFacts] : [];
    let addedChars = 0;
    for (const fact of learningCtx.facts) {
        const statement = `[learning] ${fact.domain}: ${fact.summary}`;
        if (addedChars + statement.length > maxTotalChars)
            continue;
        base.push({
            statement,
            source: "learning",
            reference: `pi-learning:${fact.evidenceDigest ?? "active"}`,
        });
        addedChars += statement.length;
    }
    return base;
}
