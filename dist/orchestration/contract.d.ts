import { Type } from "typebox";
import type { ResourceClaim } from "./claims.js";
import type { ContextPackInput } from "./context.js";
export declare const OrchestrationRequestSchema: Type.TObject<{
    id: Type.TOptional<Type.TString>;
    batch_id: Type.TOptional<Type.TString>;
    join: Type.TOptional<Type.TUnion<[Type.TLiteral<"async">, Type.TLiteral<"group">]>>;
    isolation: Type.TOptional<Type.TLiteral<"worktree">>;
    schedule: Type.TOptional<Type.TObject<{
        cron: Type.TOptional<Type.TString>;
        at: Type.TOptional<Type.TString>;
        timezone: Type.TOptional<Type.TString>;
        max_runs: Type.TOptional<Type.TInteger>;
    }>>;
    claims: Type.TOptional<Type.TArray<Type.TObject<{
        kind: Type.TUnion<[Type.TLiteral<"write">, Type.TLiteral<"test">, Type.TLiteral<"evidence">]>;
        resource: Type.TString;
        mode: Type.TUnion<[Type.TLiteral<"shared">, Type.TLiteral<"exclusive">]>;
    }>>>;
    lease_ttl_ms: Type.TOptional<Type.TNumber>;
    context: Type.TOptional<Type.TObject<{
        goal: Type.TString;
        authorization: Type.TUnion<[Type.TLiteral<"read-only">, Type.TLiteral<"write-approved">, Type.TLiteral<"sensitive-approved">]>;
        known_facts: Type.TOptional<Type.TArray<Type.TObject<{
            statement: Type.TString;
            source: Type.TUnion<[Type.TLiteral<"user">, Type.TLiteral<"repository">, Type.TLiteral<"delegated">, Type.TLiteral<"external">]>;
            reference: Type.TOptional<Type.TString>;
        }>>>;
        unknowns: Type.TOptional<Type.TArray<Type.TString>>;
        decisions: Type.TOptional<Type.TArray<Type.TObject<{
            statement: Type.TString;
            rationale: Type.TOptional<Type.TString>;
            unlock_condition: Type.TOptional<Type.TString>;
        }>>>;
        references: Type.TOptional<Type.TArray<Type.TObject<{
            path: Type.TString;
        }>>>;
        evidence: Type.TOptional<Type.TArray<Type.TObject<{
            description: Type.TString;
            reference: Type.TString;
            recorded_at: Type.TOptional<Type.TString>;
            claim: Type.TOptional<Type.TString>;
        }>>>;
        claims: Type.TOptional<Type.TArray<Type.TString>>;
        learning_claims: Type.TOptional<Type.TArray<Type.TUnion<[Type.TObject<{
            version: Type.TLiteral<1>;
            kind: Type.TUnion<[Type.TLiteral<"pattern">, Type.TLiteral<"discovery">]>;
            claimId: Type.TString;
            statement: Type.TString;
            applicability: Type.TString;
            support: Type.TObject<{
                mode: Type.TUnion<[Type.TLiteral<"direct-artifact">, Type.TLiteral<"task-outcome">]>;
                evidenceRefs: Type.TArray<Type.TObject<{
                    kind: Type.TUnion<[Type.TLiteral<"evidence-receipt">, Type.TLiteral<"repository-file">]>;
                    ref: Type.TString;
                    digest: Type.TString;
                }>>;
            }>;
        }>, Type.TObject<{
            version: Type.TLiteral<2>;
            kind: Type.TUnion<[Type.TLiteral<"pattern">, Type.TLiteral<"discovery">]>;
            claimId: Type.TOptional<Type.TString>;
            statement: Type.TString;
            applicability: Type.TString;
        }>]>>>;
        next_step: Type.TString;
        disclosure: Type.TOptional<Type.TUnion<[Type.TLiteral<"open">, Type.TLiteral<"blind-first">]>>;
    }>>;
    proof: Type.TOptional<Type.TObject<{
        mode: Type.TLiteral<"evidence-only">;
        max_evidence_age_ms: Type.TOptional<Type.TNumber>;
    }>>;
    verifier: Type.TOptional<Type.TObject<{
        required: Type.TBoolean;
        reviewer_agent: Type.TOptional<Type.TString>;
        min_reviews: Type.TOptional<Type.TNumber>;
    }>>;
}>;
export interface OrchestrationRequest {
    id?: string;
    batchId?: string;
    join?: "async" | "group";
    isolation?: "worktree";
    schedule?: {
        cron?: string;
        at?: string;
        timezone?: string;
        maxRuns?: number;
    };
    claims?: ResourceClaim[];
    leaseTtlMs?: number;
    context?: ContextPackInput;
    proof?: {
        mode: "evidence-only";
        maxEvidenceAgeMs?: number;
    };
    verifier?: {
        required: boolean;
        reviewerAgent?: string;
        minReviews?: number;
    };
}
/**
 * Parse an untrusted orchestration request.
 *
 * `claims` is validated here rather than trusted. This function used to be a
 * bare cast, so a claim like `{kind:"bogus",mode:"wat"}` was accepted, written
 * to the lease store, and then made every subsequent read of that store throw —
 * one malformed request disabled all writes until the file was deleted by hand.
 * A request carrying an invalid claim is rejected outright: silently dropping
 * the claim would grant the task a lease weaker than it asked for.
 */
export declare function parseOrchestrationRequest(value: unknown): OrchestrationRequest | undefined;
