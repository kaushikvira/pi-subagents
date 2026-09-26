import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskCompletionSnapshot } from "../subagent/waitCompletion.js";
import type { BackgroundTask } from "../types.js";
import { completeTask } from "./completion.js";
export interface BackgroundPollingDeps {
    backgroundTasks: Map<string, BackgroundTask>;
    checkTaskCompletion: (options: {
        sessionDir: string;
        sessionName: string;
        paneId?: string;
        artifactsDir?: string;
        taskId?: string;
        sinceMs?: number;
        resourceExists?: () => boolean | Promise<boolean>;
        exitSentinelPath?: string;
    }) => Promise<TaskCompletionSnapshot>;
    resourceExists?: (task: BackgroundTask) => boolean | Promise<boolean>;
    closeTask?: (task: BackgroundTask) => void | Promise<void>;
    killAgentPane: (paneId: string, originalPane: string | null) => void;
    clearTaskWidgetIfIdle: () => void;
    completeTask: typeof completeTask;
    TASK_TIMEOUT_MS: number;
    MAX_POLL_ERRORS: number;
    piDir: string;
    pi: ExtensionAPI;
}
export interface BackgroundPollingController {
    (): void;
    tick(): Promise<void>;
}
export declare function startBackgroundPolling(deps: BackgroundPollingDeps, pollMs: number): BackgroundPollingController;
