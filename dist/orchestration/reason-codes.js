import { redactSensitiveText } from "./context.js";
export const ORCHESTRATION_REASON_MAX_CHARS = 1_024;
export const ORCHESTRATION_REASON_CODES = {
    claimLeaseLost: "CLAIM_LEASE_LOST",
    independentReviewRequired: "INDEPENDENT_REVIEW_REQUIRED",
};
export function normalizeOrchestrationReason(value) {
    return redactSensitiveText(value).slice(0, ORCHESTRATION_REASON_MAX_CHARS);
}
