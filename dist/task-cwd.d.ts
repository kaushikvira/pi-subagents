export type TaskCwdResolution = {
    kind: "resolved";
    cwd: string;
} | {
    kind: "invalid";
    message: string;
};
/** Resolve a child execution directory without changing the parent control root. */
export declare function resolveTaskCwd(callerCwd: string, requestedCwd: unknown, persistedCwd?: string): TaskCwdResolution;
