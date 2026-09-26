import type { EventBus } from "@earendil-works/pi-coding-agent";
import { type ContextRequestPayloadV1, type ContextRequestPayloadV2 } from "@minhduydev/pi-core";
import type { ContextFact } from "./orchestration/context.js";
import type { UsageReceiptV1 } from "./learning-contract.js";
import { type LearningContextV1 } from "./events.js";
/** The durable binding a provider announces when it serves a context. */
export type LearningBinding = {
    projectId: string;
    trustEpoch: string;
    sessionGeneration: string;
};
export interface LearningHandshakeResult {
    /** Project binding announced by the provider, for durable persistence. */
    learningBinding: LearningBinding | undefined;
    /** Usage receipts carried by the served context, for durable persistence. */
    usageBindings: UsageReceiptV1[] | undefined;
    /** The validated learning context (facts/patterns/metrics), if any. */
    validated: LearningContextV1 | undefined;
    /** Existing facts with learning facts merged in (additive only). */
    mergedFacts: readonly ContextFact[];
    /** Whether `mergedFacts` grew beyond `existingFacts` (drives context-pack rebuild). */
    factsGrew: boolean;
}
export interface RequestLearningContextOptions {
    /**
     * Bounded window to wait for a provider's `LEARNING_CONTEXT_ACCEPTED`.
     * A provider that acknowledges synchronously skips this wait entirely.
     */
    ackTimeoutMs: number;
    /**
     * Bounded window to wait for `LEARNING_CONTEXT_SERVED` after acceptance.
     */
    servedTimeoutMs: number;
    /** Existing context facts to merge learning facts into. */
    existingFacts?: readonly ContextFact[];
}
/**
 * Request a bounded learning context over the Pi EventBus and wait for a
 * matching acknowledgement followed by a served response.
 *
 * The handshake is asynchronous: a real provider may acknowledge then serve
 * after async work, so we cannot decide synchronously whether to wait (the
 * race the old inline `if (accepted)` check lost). Instead we race the
 * acknowledgement signal against a short ACK window, then race the served
 * signal against a served window.
 *
 * Fail-open is preserved everywhere: no provider, a provider that declines
 * without acknowledging, or either window elapsing returns `undefined` so
 * learning never blocks task launch. Responses are correlated by
 * `taskId` + `correlationId` + `requestDigest`; a mismatched response never
 * attaches.
 */
export declare function requestLearningContext(events: EventBus, contextRequest: ContextRequestPayloadV1 | ContextRequestPayloadV2, options: RequestLearningContextOptions): Promise<LearningHandshakeResult | undefined>;
