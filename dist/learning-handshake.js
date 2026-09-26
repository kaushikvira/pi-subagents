import { PI_EVENTS_V2, parseContextAccepted, parseContextServed, } from "@minhduydev/pi-core";
import { SUBAGENT_LEARNING_EVENTS_V1, mergeLearningFacts, validateLearningContext, } from "./events.js";
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
export async function requestLearningContext(events, contextRequest, options) {
    let accepted = false;
    let resolveAccepted;
    const acceptedSignal = new Promise((resolve) => {
        resolveAccepted = resolve;
    });
    let resolveServed;
    const servedResponse = new Promise((resolve) => {
        resolveServed = resolve;
    });
    const matches = (event) => event !== undefined &&
        event.taskId === contextRequest.taskId &&
        event.correlationId === contextRequest.correlationId &&
        event.requestDigest === contextRequest.requestDigest;
    const unsubscribeAccepted = events.on(PI_EVENTS_V2.LEARNING_CONTEXT_ACCEPTED, (value) => {
        if (matches(parseContextAccepted(value))) {
            accepted = true;
            resolveAccepted();
        }
    });
    const unsubscribeServed = events.on(PI_EVENTS_V2.LEARNING_CONTEXT_SERVED, (value) => {
        const event = parseContextServed(value);
        if (matches(event)) {
            resolveServed(event);
        }
    });
    try {
        const requestEvent = contextRequest.protocolVersion === 2
            ? PI_EVENTS_V2.SUBAGENT_CONTEXT_REQUEST
            : SUBAGENT_LEARNING_EVENTS_V1.CONTEXT_REQUEST;
        events.emit(requestEvent, contextRequest);
        // Fast path: a provider that acknowledges synchronously (the common case
        // for the real pi-learning provider) resolves `accepted` before we await,
        // so the ACK wait is skipped and the task is not delayed.
        if (!accepted) {
            let ackTimer;
            const ackTimeout = new Promise((resolve) => {
                ackTimer = setTimeout(() => resolve(), options.ackTimeoutMs);
            });
            try {
                await Promise.race([acceptedSignal, ackTimeout]);
            }
            finally {
                if (ackTimer)
                    clearTimeout(ackTimer);
            }
        }
        if (!accepted) {
            // No provider installed, the provider declined without acknowledging,
            // or the ACK window elapsed — fail open without delaying the task.
            return undefined;
        }
        let servedTimer;
        const servedTimeout = new Promise((resolve) => {
            servedTimer = setTimeout(() => resolve(undefined), options.servedTimeoutMs);
        });
        const served = await Promise.race([
            servedResponse,
            servedTimeout,
        ]).finally(() => {
            if (servedTimer)
                clearTimeout(servedTimer);
        });
        if (!served) {
            // Provider accepted but never served within the window — fail open.
            return undefined;
        }
        const validated = validateLearningContext(served.context);
        const learningBinding = {
            projectId: served.projectId,
            trustEpoch: served.trustEpoch,
            sessionGeneration: served.sessionGeneration,
        };
        const usageBindings = validated?.usageReceipts
            ? [...validated.usageReceipts]
            : undefined;
        const existingFacts = options.existingFacts;
        const mergedFacts = mergeLearningFacts(existingFacts, validated, 1200);
        const factsGrew = mergedFacts.length > (existingFacts?.length ?? 0);
        return { learningBinding, usageBindings, validated, mergedFacts, factsGrew };
    }
    catch {
        // fail-open: any listener/emit error must not block task launch
        return undefined;
    }
    finally {
        unsubscribeAccepted();
        unsubscribeServed();
    }
}
