export declare const DEFAULT_LEASE_TTL_MS: number;
export type ResourceClaimKind = "write" | "test" | "evidence";
export type ResourceClaimMode = "shared" | "exclusive";
export interface ResourceClaim {
    kind: ResourceClaimKind;
    resource: string;
    mode: ResourceClaimMode;
}
export interface ResourceLease {
    id: string;
    owner: string;
    /** Canonical execution root in which relative claim resources are interpreted. */
    scope?: string;
    claims: ResourceClaim[];
    acquiredAt: string;
    heartbeatAt?: string;
    expiresAt: string;
    /**
     * Monotonically increasing token, unique per store. Present it on every write;
     * a stale fence is refused even when the owner id still matches.
     */
    fence: number;
}
/**
 * Reporter for a store that had to be quarantined. Wired to the Pi event bus by
 * the runtime; a corrupt store used to throw on every subsequent operation, so
 * one bad claim bricked all writes until a human deleted the file by hand.
 */
export type StoreQuarantineReporter = (info: {
    storePath: string;
    quarantinePath: string;
    reason: string;
}) => void;
export declare function setStoreQuarantineReporter(reporter: StoreQuarantineReporter): void;
export interface AcquireResourceLeaseInput {
    storePath: string;
    owner: string;
    scope?: string;
    claims: readonly ResourceClaim[];
    now?: Date;
    ttlMs?: number;
}
export interface ListResourceLeasesInput {
    storePath: string;
    now?: Date;
}
export interface ReleaseResourceLeaseInput {
    storePath: string;
    leaseId: string;
    /**
     * The owner the caller believes holds the lease. Required: `release` used to
     * take only a lease id, so any caller could drop any other task's lease.
     * System-side reaping of dead owners goes through
     * {@link releaseOrphanedLeases}, which proves liveness instead of ownership.
     */
    expectedOwner: string;
    /** Exact lease generation held by the caller. */
    expectedFence: number;
    now?: Date;
}
export interface TransferResourceLeaseOwnershipInput {
    storePath: string;
    leaseId: string;
    owner: string;
    /** The owner the caller believes currently holds the lease. Required. */
    expectedOwner: string;
    /** Exact lease generation held by the caller. */
    expectedFence: number;
    now?: Date;
}
export interface RenewResourceLeaseInput {
    storePath: string;
    leaseId: string;
    owner: string;
    /** Exact lease generation held by the caller. */
    expectedFence: number;
    ttlMs?: number;
    now?: Date;
}
export declare class ResourceClaimConflictError extends Error {
    readonly owner: string;
    readonly resource: string;
    readonly conflictingResource: string;
    readonly kind: ResourceClaimKind;
    constructor(input: {
        owner: string;
        resource: string;
        conflictingResource: string;
        kind: ResourceClaimKind;
    });
}
export declare function acquireResourceLease(input: AcquireResourceLeaseInput): Promise<ResourceLease>;
/**
 * Active leases. A pure READ — it never rewrites the store.
 *
 * It used to prune expired leases and write them back, so every read was a
 * write: it took the lock, produced disk I/O on a hot path, and a read racing a
 * write could drop a lease another caller had just acquired. Pruning is now an
 * explicit operation ({@link pruneExpiredLeases}).
 */
export declare function listActiveResourceLeases(input: ListResourceLeasesInput): Promise<ResourceLease[]>;
/** Drop expired leases from the store. Returns the ids removed. */
export declare function pruneExpiredLeases(input: ListResourceLeasesInput): Promise<string[]>;
export declare function transferResourceLeaseOwnership(input: TransferResourceLeaseOwnershipInput): Promise<ResourceLease | undefined>;
export declare function renewResourceLease(input: RenewResourceLeaseInput): Promise<ResourceLease | undefined>;
export declare function releaseResourceLease(input: ReleaseResourceLeaseInput): Promise<boolean>;
export interface ReleaseOrphanedLeasesInput {
    storePath: string;
    aliveOwnerIds: ReadonlySet<string>;
    now?: Date;
}
/**
 * Release active leases whose owner is no longer an alive task (Herdr §16.3 —
 * handle abandoned locks on crash/freeze/compact, don't wait for TTL expiry).
 * Returns the reaped lease ids.
 *
 * Runs inside a SINGLE lock. It used to snapshot the leases, drop the lock, and
 * then re-acquire it once per release — so a lease acquired between the snapshot
 * and its release was reaped on the strength of a stale observation.
 */
export declare function releaseOrphanedLeases(input: ReleaseOrphanedLeasesInput): Promise<string[]>;
export declare function claimCoversPath(resource: string, path: string): boolean;
export declare function leaseCoversPath(lease: ResourceLease, path: string): boolean;
export interface FindClaimCoveringPathInput {
    storePath: string;
    scope?: string;
    path: string;
    now?: Date;
}
export declare function findClaimCoveringPath(input: FindClaimCoveringPathInput): Promise<ResourceLease | undefined>;
export interface AssertNoConflictingWriteInput {
    storePath: string;
    scope?: string;
    ownerTaskId: string;
    path: string;
    /**
     * The fence the caller was issued when it acquired its lease. When supplied,
     * a write is refused if the covering lease has moved past it — the caller's
     * lease lapsed and was re-acquired (possibly by itself) while it was not
     * looking, so its in-memory belief about the resource is stale.
     */
    fence?: number;
    now?: Date;
}
export declare function assertNoConflictingWrite(input: AssertNoConflictingWriteInput): Promise<void>;
export declare function claimsConflict(left: ResourceClaim, right: ResourceClaim): boolean;
export declare function isResourceLease(value: unknown): value is ResourceLease;
export declare function isResourceClaim(value: unknown): value is ResourceClaim;
