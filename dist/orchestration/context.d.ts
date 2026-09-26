import { type LearningClaim } from "../learning-contract.js";
import { type HandoffPackV1 } from "@minhduydev/pi-core/workflow";
export type ContextProvenance = "user" | "repository" | "delegated" | "external"
/** Non-authoritative facts imported from the learning store. */
 | "learning";
export type ContextAuthorization = "read-only" | "write-approved" | "sensitive-approved";
export interface ContextFact {
    statement: string;
    source: ContextProvenance;
    reference?: string;
}
export interface ContextDecision {
    statement: string;
    rationale?: string;
    /** Observable evidence that would justify revisiting this locked decision. */
    unlockCondition?: string;
}
export interface ContextEvidence {
    description: string;
    reference: string;
    recordedAt?: string;
    claim?: string;
    receiptId?: string;
    sha256?: string;
    source?: "declared" | "runtime-receipt" | "runtime-session";
    receiptKind?: "file" | "test" | "command-output" | "session" | "diff";
    exitCode?: number;
    /** Runtime-observed command metadata. Never populated from child prose. */
    command?: string;
    cwd?: string;
    toolCallId?: string;
    sessionDigest?: string;
}
export interface ContextReferenceInput {
    path: string;
}
export interface ContextReference {
    path: string;
    digest: string;
}
export type ContextDisclosure = "open" | "blind-first";
export interface BlindOrientationRecord {
    text: string;
    digest: string;
    recordedAt: string;
}
export interface BlindDisclosureState {
    phase: "awaiting-orientation" | "orientation-recorded" | "continuation-dispatching" | "continuation-started";
    orientation?: BlindOrientationRecord;
    continuationAttemptId?: string;
    continuationCorrelationId?: string;
    continuationDispatchStartedAt?: string;
    continuationStartedAt?: string;
    continuedInvocationId?: string;
}
export interface ContextPackInput {
    goal: string;
    authorization: ContextAuthorization;
    knownFacts?: readonly ContextFact[];
    unknowns?: readonly string[];
    decisions?: readonly ContextDecision[];
    references?: readonly ContextReferenceInput[];
    evidence?: readonly ContextEvidence[];
    claims?: readonly string[];
    learningClaims?: readonly LearningClaim[];
    nextStep: string;
    /**
     * Durable disclosure policy.  "blind-first" requires a separate orientation
     * turn before any facts, decisions, evidence, or acceptance claims are sent.
     */
    disclosure?: ContextDisclosure;
}
export interface ContextPack {
    version: number;
    id: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    goal: string;
    authorization: ContextAuthorization;
    knownFacts: ContextFact[];
    unknowns: string[];
    decisions: ContextDecision[];
    references: ContextReference[];
    evidence: ContextEvidence[];
    claims: string[];
    learningClaims: LearningClaim[];
    nextStep: string;
    disclosure: ContextDisclosure;
    blindDisclosure?: BlindDisclosureState;
    /** Canonical fourteen-section handoffs shared with the harness. */
    workflowHandoffs: HandoffPackV1[];
}
export interface ContextHandoffPatch {
    decisions?: readonly ContextDecision[];
    evidence?: readonly ContextEvidence[];
    unknowns?: readonly string[];
    nextStep?: string;
    workflowHandoff?: HandoffPackV1;
}
export declare function buildContextPack(input: {
    projectDirectory: string;
    input: ContextPackInput;
    now?: Date;
}): Promise<ContextPack>;
export interface RenderContextPackOptions {
    /** @deprecated Disclosure is persisted on the Context Pack. */
    disclosure?: ContextDisclosure;
}
/**
 * Render a Context Pack into the child prompt.
 *
 * `pack.claims` is deliberately NOT rendered: the acceptance claims stay in the
 * data model and are enforced verifier-side by the proof gate. Handing the
 * child the exact strings it will be graded against invites Goodharting —
 * writing to the rubric instead of solving the problem.
 */
export declare function renderContextPackForPrompt(pack: ContextPack, options?: RenderContextPackOptions): string;
export declare function saveContextPack(input: {
    storeDirectory: string;
    key: string;
    pack: ContextPack;
}): Promise<void>;
export declare function loadContextPack(input: {
    storeDirectory: string;
    key: string;
}): Promise<ContextPack | undefined>;
export declare function updateContextHandoff(input: {
    storeDirectory: string;
    key: string;
    patch: ContextHandoffPatch;
    now?: Date;
}): Promise<ContextPack>;
/**
 * Persist the independent first-turn read before the withheld context is made
 * available.  Retrying the same turn is idempotent; a different orientation
 * cannot overwrite the already recorded observation.
 */
export declare function recordBlindOrientation(input: {
    storeDirectory: string;
    key: string;
    text: string;
    now?: Date;
}): Promise<ContextPack>;
export declare function beginBlindContinuation(input: {
    storeDirectory: string;
    key: string;
    attemptId: string;
    correlationId: string;
    now?: Date;
}): Promise<ContextPack>;
export declare function markBlindContinuationStarted(input: {
    storeDirectory: string;
    key: string;
    attemptId: string;
    continuedInvocationId: string;
    now?: Date;
}): Promise<ContextPack>;
export declare function redactSensitiveText(value: string): string;
