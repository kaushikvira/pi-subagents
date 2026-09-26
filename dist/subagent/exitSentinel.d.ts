export interface TaskExitSentinel {
    schemaVersion: 1;
    taskId: string;
    exitCode: number;
    completedAt: string;
}
export declare function getExitSentinelPath(piDir: string, taskId: string): string;
export declare function ensureExitSentinelDirectory(path: string): void;
export declare function readExitSentinel(path: string, taskId: string): TaskExitSentinel | null;
export declare function wrapWithHerdrExitSentinel(command: string, sentinelPath: string, taskId: string): string;
