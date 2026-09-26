export declare function sessionDirForTask(artifactsDir: string, taskId: string): string;
export declare function sessionJsonlExists(artifactsDir: string, taskId: string): boolean;
export type SubagentFailureKind = "pane_exit" | "no_result" | "timeout";
export declare function enrichSubagentFailureMessage(input: {
    kind: SubagentFailureKind;
    baseMessage: string;
    paneId?: string;
    artifactsDir?: string;
    taskId?: string;
    elapsedMs?: number;
}): string;
