import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ResourceClaim } from "./claims.js";
export type UpstreamTaskExtension = (pi: ExtensionAPI) => void;
export declare function resolveUpstreamTaskExtension(moduleValue: unknown): UpstreamTaskExtension;
export declare function createTaskRuntime(upstreamTaskExtension: UpstreamTaskExtension): UpstreamTaskExtension;
/** Configuration a parent passes to a child so it can enforce claims on itself. */
export interface ChildClaimGuardConfig {
    version: 2;
    /** The PARENT project directory — where the lease store lives. */
    projectDirectory: string;
    leaseStore: string;
    /** Runtime-owned state updated whenever ownership/fence changes. */
    guardStatePath: string;
    /** A missing state file blocks project writes when this launch owns claims. */
    guardStateRequired: boolean;
}
export interface ChildClaimGuardState {
    version: 1;
    invocationId: string;
    leaseId: string;
    owner: string;
    fence: number;
    claims: ResourceClaim[];
    updatedAt: string;
}
export declare const CHILD_CLAIM_GUARD_ENV = "PI_SUBAGENTS_CLAIM_GUARD";
export declare function parseChildClaimGuardConfig(raw: string | undefined): ChildClaimGuardConfig | undefined;
