/**
 * Learning-contract surface, now sourced from @minhduydev/pi-core.
 *
 * This module used to carry its own `taggedDigest`, canonicalization, and
 * claim/receipt validation — one of the nine digest copies the 2026-07-26
 * audit found (§2.2). The primitives and types come from pi-core now, so the
 * producer and every consumer hash the same preimage by construction.
 *
 * What stays local is POLICY, not primitives: at the tool input boundary this
 * package throws on an out-of-bounds or malformed claim list rather than
 * silently dropping entries — a caller that supplied a bad claim should hear
 * about it, not have it quietly vanish from its lease.
 */
import { type LearningClaimIntentV2, type LearningClaimV1, type SupportedLearningClaimV1, type TaggedSha256V1, type UsageReceiptV1 } from "@minhduydev/pi-core";
import { taggedDigest } from "@minhduydev/pi-core";
export { taggedDigest };
export type { LearningClaimIntentV2, LearningClaimV1, SupportedLearningClaimV1, TaggedSha256V1, UsageReceiptV1, };
export type LearningClaimKindV1 = LearningClaimV1["kind"];
export type LearningSupportModeV1 = LearningClaimV1["support"]["mode"];
export type LearningEvidenceKindV1 = LearningClaimV1["support"]["evidenceRefs"][number]["kind"];
export type LearningEvidenceRefV1 = LearningClaimV1["support"]["evidenceRefs"][number];
export type LearningClaim = LearningClaimV1 | LearningClaimIntentV2;
export declare function makeLearningClaim(value: unknown): LearningClaimV1;
export declare function makeLearningClaimIntent(value: unknown): LearningClaimIntentV2;
/** STRICT list parse for the tool boundary: invalid or mixed-version input throws. */
export declare function parseLearningClaims(value: unknown): LearningClaim[];
/** STRICT list parse for the tool boundary: invalid input throws. */
export declare function parseUsageReceipts(value: unknown): UsageReceiptV1[];
/** STRICT list parse for the tool boundary: invalid input throws. */
export declare function parseSupportedLearningClaims(value: unknown): SupportedLearningClaimV1[];
