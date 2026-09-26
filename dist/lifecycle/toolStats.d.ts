import type { BackgroundTask } from "../types.js";
export declare function startToolStatsPolling(foregroundTasks: Map<string, BackgroundTask>, backgroundTasks: Map<string, BackgroundTask>, intervalMs: number, onUpdate?: () => void): NodeJS.Timeout;
