export interface WorktreeHandle {
    repositoryRoot: string;
    path: string;
    branch: string;
    baseSha: string;
    createdAt: string;
}
export interface WorktreeResult extends WorktreeHandle {
    changedPaths: string[];
    diffDigest: string;
    retained: boolean;
}
export declare function createTaskWorktree(input: {
    cwd: string;
    taskIdHint?: string;
    base?: string;
}): WorktreeHandle;
export declare function inspectTaskWorktree(handle: WorktreeHandle): WorktreeResult;
export declare function finalizeTaskWorktree(handle: WorktreeHandle): WorktreeResult;
export declare function mergeTaskWorktree(handle: WorktreeHandle, message?: string, expectedDiffDigest?: string): {
    commitSha: string;
    mergeSha: string;
    result: WorktreeResult;
};
export declare function removeTaskWorktree(handle: WorktreeHandle, force?: boolean): void;
