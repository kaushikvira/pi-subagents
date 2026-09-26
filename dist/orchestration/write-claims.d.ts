import { type ResourceLease } from "./claims.js";
export interface WriteClaimsAuditResult {
    valid: boolean;
    issues: string[];
    uncoveredPaths: string[];
}
export declare function isGitRepository(projectDirectory: string): boolean;
/**
 * Returns the paths that git reports as changed in the working tree of
 * `projectDirectory` (tracked modifications plus untracked files). Returns an
 * empty list when git is unavailable or the directory is not a repository.
 */
export declare function changedPathsInRepository(projectDirectory: string): string[];
/**
 * Post-hoc audit: every working-tree change must be covered by a write/test
 * claim on `lease`. Returns the uncovered paths and one issue per uncovered
 * path. Non-git projects (or missing leases handled by the caller) are treated
 * as valid.
 */
export declare function auditWriteClaims(lease: ResourceLease, projectDirectory: string): WriteClaimsAuditResult;
