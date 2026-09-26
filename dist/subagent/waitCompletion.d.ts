export type TaskCompletionStatus = "running" | "completed" | "failed" | "cancelled" | "timeout";
export interface TaskCompletionSnapshot {
    status: TaskCompletionStatus;
    content: string;
    source?: "session-jsonl" | "pane" | "exit-sentinel" | "timeout" | "signal";
}
export interface WaitForTaskCompletionOptions {
    sessionDir: string;
    sessionName: string;
    paneId?: string;
    artifactsDir?: string;
    taskId?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    pollMs?: number;
    sinceMs?: number;
    resourceExists?: () => boolean | Promise<boolean>;
    exitSentinelPath?: string;
}
export declare function checkTaskCompletion(options: Omit<WaitForTaskCompletionOptions, "signal" | "timeoutMs" | "pollMs">): Promise<TaskCompletionSnapshot>;
export declare function waitForTaskCompletion(options: WaitForTaskCompletionOptions): Promise<TaskCompletionSnapshot>;
