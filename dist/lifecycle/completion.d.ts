import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundTask } from "../types.js";
export declare function completeTask(pi: ExtensionAPI, id: string, task: BackgroundTask, content: string, phase: "done" | "timeout" | "failed", piDir: string, resourceCloser?: (task: BackgroundTask) => void): void;
