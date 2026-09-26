import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { leaseCoversPath } from "./claims.js";
export function isGitRepository(projectDirectory) {
    return existsSync(join(projectDirectory, ".git"));
}
/**
 * Returns the paths that git reports as changed in the working tree of
 * `projectDirectory` (tracked modifications plus untracked files). Returns an
 * empty list when git is unavailable or the directory is not a repository.
 */
export function changedPathsInRepository(projectDirectory) {
    try {
        const output = execFileSync("git", ["-c", "core.quotePath=false", "status", "--porcelain", "--untracked-files=all"], { cwd: projectDirectory, encoding: "utf8" });
        return output
            .split("\n")
            .map((line) => parsePorcelainLine(line))
            .filter((path) => path.length > 0);
    }
    catch {
        return [];
    }
}
function parsePorcelainLine(line) {
    if (line.length < 3) {
        return "";
    }
    let path = line.slice(3);
    const renameArrow = path.indexOf(" -> ");
    if (renameArrow !== -1) {
        path = path.slice(renameArrow + 4);
    }
    if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
        path = path.slice(1, -1);
    }
    return path.trim();
}
/**
 * Post-hoc audit: every working-tree change must be covered by a write/test
 * claim on `lease`. Returns the uncovered paths and one issue per uncovered
 * path. Non-git projects (or missing leases handled by the caller) are treated
 * as valid.
 */
export function auditWriteClaims(lease, projectDirectory) {
    if (!isGitRepository(projectDirectory)) {
        return { valid: true, issues: [], uncoveredPaths: [] };
    }
    const changed = changedPathsInRepository(projectDirectory).filter((path) => !path.startsWith(".pi/"));
    const uncoveredPaths = changed.filter((path) => !leaseCoversPath(lease, path));
    return {
        valid: uncoveredPaths.length === 0,
        issues: uncoveredPaths.map((path) => `Write outside declared claims: ${path}`),
        uncoveredPaths,
    };
}
