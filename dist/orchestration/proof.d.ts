import type { LearningClaim, SupportedLearningClaimV1 } from "../learning-contract.js";
import type { ContextEvidence } from "./context.js";
import type { SemanticAttestationV1 } from "./run-store.js";
export interface EvidenceProofResult {
    valid: boolean;
    /** Integrity (fresh, runtime-owned, digest-bound receipt) is separate from
     * semantic substantiation of the requested claims. */
    receiptIntegrityValid: boolean;
    semanticProofValid: boolean;
    issues: string[];
    supportedClaims: SupportedLearningClaimV1[];
}
export declare function validateEvidenceOnlyProof(input: {
    projectDirectory: string;
    allowedProjectDirectories?: readonly string[];
    evidence: readonly ContextEvidence[];
    now?: Date;
    maxEvidenceAgeMs: number;
    claims?: readonly string[];
    learningClaims?: readonly LearningClaim[];
    /** Reviewer-owned, canonical semantic attestations. */
    semanticAttestations?: readonly SemanticAttestationV1[];
    /** Current subject digest to which each attestation must bind. */
    subjectDigest?: string;
}): Promise<EvidenceProofResult>;
