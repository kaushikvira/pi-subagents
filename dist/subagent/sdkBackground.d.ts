import { type WorktreeHandle, type WorktreeResult } from "../worktree.js";
export interface SdkBackgroundResult {
    output: string;
    sessionPath?: string | null;
}
export interface SdkBackgroundTaskInput {
    id: string;
    agentType: string;
    description: string;
    sessionName: string;
    startedAt: number;
    piDir: string;
    artifactsDir: string;
    cwd?: string;
    conversationId?: string;
    worktree?: WorktreeHandle;
    run: () => Promise<SdkBackgroundResult>;
    onComplete?: (result: SdkBackgroundResult, worktree?: WorktreeResult) => void;
    onFailed?: (error: unknown, worktree?: WorktreeResult) => void;
    onSettled?: () => void;
    now?: () => number;
}
export declare function startSdkBackgroundTask(input: SdkBackgroundTaskInput): void;
export declare function formatSdkBackgroundReceipt(id: string): string;
