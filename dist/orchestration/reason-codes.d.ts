export declare const ORCHESTRATION_REASON_MAX_CHARS = 1024;
export declare const ORCHESTRATION_REASON_CODES: {
    readonly claimLeaseLost: "CLAIM_LEASE_LOST";
    readonly independentReviewRequired: "INDEPENDENT_REVIEW_REQUIRED";
};
export type OrchestrationReasonCode = (typeof ORCHESTRATION_REASON_CODES)[keyof typeof ORCHESTRATION_REASON_CODES];
export declare function normalizeOrchestrationReason(value: string): string;
